import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

const $=id=>document.getElementById(id);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',logarithmicDepthBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
document.body.prepend(renderer.domElement);
renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Interactive 3D view of The Grove');
const scene=new THREE.Scene();scene.background=new THREE.Color('#cbdde0');scene.fog=new THREE.Fog('#cbdde0',650,1300);
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.15,2200);camera.position.set(300,250,300);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.12;controls.maxDistance=800;controls.minDistance=.7;controls.maxPolarAngle=Math.PI*.93;controls.target.set(0,0,0);
scene.add(new THREE.HemisphereLight(0xe6f0ff,0x9b987b,2.05));
const sun=new THREE.DirectionalLight(0xfff2d7,3.0);sun.position.set(-160,270,120);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-240,right:240,top:240,bottom:-240,near:80,far:650});sun.shadow.bias=-.00065;sun.shadow.normalBias=.16;scene.add(sun);scene.add(sun.target);
// Locally generated soft sky environment; no remote imagery or network dependency.
const ec=document.createElement('canvas');ec.width=512;ec.height=256;const cx=ec.getContext('2d');const grad=cx.createLinearGradient(0,0,0,256);grad.addColorStop(0,'#aabfce');grad.addColorStop(.48,'#e8ebdf');grad.addColorStop(.52,'#8e9475');grad.addColorStop(1,'#595d44');cx.fillStyle=grad;cx.fillRect(0,0,512,256);
const sky=new THREE.CanvasTexture(ec);sky.mapping=THREE.EquirectangularReflectionMapping;sky.colorSpace=THREE.SRGBColorSpace;
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(sky).texture;scene.environmentIntensity=.32;pmrem.dispose();sky.dispose();
const cv=a=>new THREE.Vector3(a[0],a[2],-a[1]);
let metadata,ready=false,mode='orbit',animation=null,frames=0,frameStart=performance.now(),last=performance.now(),fps=0,drag=null;
let yaw=0,pitch=0;const keys=new Set(),treeSets=[];const temp=new THREE.Object3D();let treeAngle=99;
const slots=[['01 ','Whole estate'],['43 ','Mansion & canal'],['35 ','Garden Rooms'],['36 ','Cedar Suite'],['41 ','Stables north passage'],['50 ','Stables restaurant'],['39 ','Pool & beach'],['40 ','Walled Garden glasshouse'],['26 ','Walled Garden from above'],['48 ','Mansion east approach'],['52 ','Front reception'],['53 ','Amber entrance'],['54 ','Stables golf porch'],['55 ','Reception east colonnade'],['56 ','Reception right curved return'],['57 ','Sequoia courtyard'],['58 ','Sequoia entrance'],['59 ','Garden paths'],['60 ','Stables and spa context'],['61 ','Reception wall and bow'],['62 ','Sunken garden'],['63 ','Sunken garden steps'],['64 ','Sunken garden context'],['65 ','Glasshouse pond garden'],['66 ','Glasshouse dining terrace'],['67 ','Cedar annex corridor'],['68 ','Cedar connection from above']];
const stats={errors:[],source:'V30',ready:false};window.groveViewerStats=stats;
window.addEventListener('error',e=>stats.errors.push(e.message));
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();$('status').textContent='Graphics paused. Reload this page to resume.'});

function setMode(next){mode=next;controls.enabled=mode==='orbit';keys.clear();$('orbit').setAttribute('aria-pressed',mode==='orbit');$('walk').setAttribute('aria-pressed',mode==='walk');$('hint').textContent=mode==='orbit'?'Drag to look around · scroll or pinch to zoom · right-drag to pan':'Drag to look · W A S D or arrows to move · Q / E down / up · Shift for speed';
 if(mode==='walk'){const dir=camera.getWorldDirection(new THREE.Vector3());yaw=Math.atan2(-dir.x,-dir.z);pitch=Math.asin(dir.y)}
 else {const dir=camera.getWorldDirection(new THREE.Vector3());controls.target.copy(camera.position).addScaledVector(dir,15);controls.update()}
}
function jump(index,instant=false){if(!ready)return;const rec=metadata.cameras.find(x=>x.name.startsWith(slots[index][0]));if(!rec)return;
 const p=cv(rec.position),d=cv(rec.direction).normalize();const overhead=p.y>25;
 const distance=index===25?14:index===24?22:index===23?28:index===20?26:index===21?10:index===15?18:index===16?7:overhead?Math.min(420,Math.max(45,p.y/Math.max(.15,-d.y))):25;
 const target=p.clone().addScaledVector(d,distance);
 if(index===0)p.lerp(target,.23);
 setMode('orbit');camera.fov=overhead?Math.max(48,Math.min(78,48/Math.min(1,camera.aspect/1.3))):((index===15||index===16||index===20||index===21||index===23||index===24||index===25)&&camera.aspect<1?82:60);camera.updateProjectionMatrix();
 if(instant){camera.position.copy(p);controls.target.copy(target);controls.update()}
 else animation={start:performance.now(),fromP:camera.position.clone(),fromT:controls.target.clone(),toP:p,toT:target};
 $('place').value=String(index);stats.location=slots[index][1];
}

// Merge static architecture in spatial groups; preserve real materials and all source positions.
// Web build: the compressed model stores numbers in compact form; expand them back to plain floats before merging.
function toFloat(geom){for(const [name,a] of Object.entries(geom.attributes)){if(a.array instanceof Float32Array&&!a.isInterleavedBufferAttribute)continue;const n=a.itemSize,get=[i=>a.getX(i),i=>a.getY(i),i=>a.getZ(i),i=>a.getW(i)],arr=new Float32Array(a.count*n);for(let i=0;i<a.count;i++)for(let c=0;c<n;c++)arr[i*n+c]=get[c](i);geom.setAttribute(name,new THREE.BufferAttribute(arr,n))}return geom}
function optimise(root){root.updateMatrixWorld(true);const batches=new Map(),remove=[];let originalMeshes=0;
 root.traverse(o=>{if(!o.isMesh)return;originalMeshes++;o.castShadow=!o.material.transparent;o.receiveShadow=true;
  if(o.isInstancedMesh){o.computeBoundingSphere();return}
  if(Array.isArray(o.material))return;
  const geom=o.geometry;const center=new THREE.Vector3();geom.computeBoundingSphere();center.copy(geom.boundingSphere.center).applyMatrix4(o.matrixWorld);
  const key=`${o.material.uuid}:${Math.floor(center.x/60)}:${Math.floor(center.z/60)}:${Object.keys(geom.attributes).sort().join(',')}`;
  if(!batches.has(key))batches.set(key,{material:o.material,geos:[]});
  const g=toFloat(geom.clone()).applyMatrix4(o.matrixWorld);if(g.index){const ng=g.toNonIndexed();g.dispose();batches.get(key).geos.push(ng)}else batches.get(key).geos.push(g);remove.push(o);
 });
 for(const o of remove)o.removeFromParent();
 for(const b of batches.values()){let merged=mergeGeometries(b.geos,false);if(!merged)continue;merged.computeBoundingSphere();const ob=new THREE.Mesh(merged,b.material);ob.castShadow=!b.material.transparent;ob.receiveShadow=true;scene.add(ob);for(const g of b.geos)g.dispose()}
 stats.originalMeshes=originalMeshes;stats.staticBatches=batches.size;
}

async function makeTrees(){const loader=new THREE.TextureLoader();
 for(const [id,info] of Object.entries(metadata.tree_prototypes)){
  const entries=metadata.trees.filter(t=>String(t.prototype)===id).map(t=>{const m=new THREE.Matrix4().set(...t.matrix.flat());const pos=new THREE.Vector3(),q=new THREE.Quaternion(),sc=new THREE.Vector3();m.decompose(pos,q,sc);const center=new THREE.Vector3(...info.center).applyMatrix4(m);return {center:cv(center.toArray()),scale:sc};});
  const sideMap=await loader.loadAsync(`./assets/tree-${id}-side.png`),topMap=await loader.loadAsync(`./assets/tree-${id}-top.png`);sideMap.colorSpace=topMap.colorSpace=THREE.SRGBColorSpace;
  const sideMat=new THREE.MeshBasicMaterial({map:sideMap,alphaTest:.35,side:THREE.DoubleSide,toneMapped:false});
  const topMat=new THREE.MeshBasicMaterial({map:topMap,alphaTest:.35,side:THREE.DoubleSide,toneMapped:false});
  const geom=new THREE.PlaneGeometry(info.size,info.size);const side=new THREE.InstancedMesh(geom,sideMat,entries.length),top=new THREE.InstancedMesh(geom,topMat,entries.length);
  side.frustumCulled=top.frustumCulled=false;
  for(let i=0;i<entries.length;i++){const e=entries[i];temp.position.copy(e.center);temp.rotation.set(-Math.PI/2,0,0);temp.scale.set(e.scale.x,e.scale.y,1);temp.updateMatrix();top.setMatrixAt(i,temp.matrix)}
  top.instanceMatrix.needsUpdate=true;scene.add(side,top);treeSets.push({side,top,entries});
 }
 updateTrees(true);
}
function updateTrees(force=false){const d=camera.getWorldDirection(new THREE.Vector3());const a=Math.atan2(-d.x,-d.z);if(!force&&Math.abs(a-treeAngle)<.015)return;treeAngle=a;
 for(const group of treeSets){for(let i=0;i<group.entries.length;i++){const e=group.entries[i];temp.position.copy(e.center);temp.rotation.set(0,a,0);temp.scale.set(e.scale.x,e.scale.z,1);temp.updateMatrix();group.side.setMatrixAt(i,temp.matrix)}group.side.instanceMatrix.needsUpdate=true}
}

try{
 metadata=await fetch('./assets/scene-v30.json').then(r=>{if(!r.ok)throw new Error('Viewing model metadata unavailable');return r.json()});
 const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('./assets/grove-v30-viewing.glb',e=>{if(e.total){$('progress').value=e.loaded/e.total*85;$('loadText').textContent=`Opening the grounds… ${Math.round(e.loaded/e.total*100)}%`}});
 $('loadText').textContent='Preparing the buildings and gardens…';await new Promise(r=>setTimeout(r,30));
 // Real-time water tint stands in for the master's ray-traced transmission and absorption.
 const tuned=new Set();gltf.scene.traverse(o=>{if(!o.isMesh)return;for(const mat of Array.isArray(o.material)?o.material:[o.material]){
  if(tuned.has(mat))continue;tuned.add(mat);const name=mat.name.toLowerCase().replaceAll('_',' ');
  if(name.includes('v25')&&name.includes('entrance door glass')){mat.color.set('#a6c4bc');mat.opacity=.13;mat.transparent=true;mat.depthWrite=false;mat.roughness=.07;mat.metalness=.04;mat.envMapIntensity=.6}
  else if(name.includes('turquoise')){mat.color.set('#409ca8');mat.opacity=.38;mat.transparent=true;mat.depthWrite=false;mat.roughness=.2;mat.metalness=.05}
  else if(name.includes('ornamental water')){mat.color.set('#36515a');mat.opacity=.48;mat.transparent=true;mat.depthWrite=false;mat.roughness=.22;mat.metalness=.08}
 }});
 scene.add(gltf.scene);optimise(gltf.scene);
 await makeTrees();
 $('place').innerHTML=slots.map(([_,label],i)=>`<option value="${i}">${label}</option>`).join('');
 ready=true;stats.ready=true;stats.master=metadata.source;stats.treeCount=metadata.trees.length;renderer.shadowMap.needsUpdate=true;jump(({front:10,amber:11,golf:12,east:13,west:14,sequoia:15,spa:16,paths:17,context:18,return:19,sunken:20,bowl:21,gardencontext:22,ponds:23,terrace:24,cedarlink:25,linkplan:26})[new URLSearchParams(location.search).get('view')]??0,true);
 $('loading').remove();
}catch(e){stats.errors.push(e.message);$('loadText').textContent=`Could not open the viewer: ${e.message}. Use the local “Open Grove Viewer” launcher, then try again.`;$('progress').remove();console.error(e)}

$('place').addEventListener('change',e=>jump(Number(e.target.value)));$('home').onclick=()=>jump(0);$('orbit').onclick=()=>setMode('orbit');$('walk').onclick=()=>{if(camera.position.y>10){jump(2,true)}setMode('walk')};
$('helpButton').onclick=()=>$('help').showModal();$('closeHelp').onclick=()=>$('help').close();
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{}};
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
const accepted=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','ShiftLeft','ShiftRight'];
window.addEventListener('keydown',e=>{if(mode!=='walk'||/SELECT|INPUT|TEXTAREA/.test(document.activeElement.tagName)||$('help').open)return;if(accepted.includes(e.code)){e.preventDefault();keys.add(e.code);if(!e.repeat)moveWalk(1/60)}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();drag=null});
renderer.domElement.addEventListener('pointerdown',e=>{animation=null;renderer.domElement.focus();if(mode==='walk'){drag={x:e.clientX,y:e.clientY,id:e.pointerId};renderer.domElement.setPointerCapture(e.pointerId)}});
renderer.domElement.addEventListener('pointermove',e=>{if(!drag||mode!=='walk')return;yaw-=(e.clientX-drag.x)*.004;pitch=THREE.MathUtils.clamp(pitch-(e.clientY-drag.y)*.004,-1.4,1.4);drag.x=e.clientX;drag.y=e.clientY});
renderer.domElement.addEventListener('pointerup',()=>drag=null);renderer.domElement.addEventListener('pointercancel',()=>drag=null);
for(const [id,key] of [['forward','KeyW'],['back','KeyS']]){$(id).addEventListener('pointerdown',e=>{setMode('walk');keys.add(key);e.currentTarget.setPointerCapture(e.pointerId)});$(id).addEventListener('pointerup',()=>keys.delete(key));$(id).addEventListener('pointercancel',()=>keys.delete(key))}

// Permit the photographed below-grade courtyard while keeping ordinary ground limits.
function groundHeight(p){const radius=Math.hypot(p.x+48.208466,-p.z+118.322029);if(radius<5.65)return -1.45;if(radius<8.55)return -1.45+(radius-5.65)/2.9*1.605;const dx=p.x+91.591944,dy=-p.z+134.663804,L=Math.hypot(1,.224);const x=(dx+.224*dy)/L,y=(-.224*dx+dy)/L;return ((Math.abs(x)<4.9&&y>23.15&&y<32.3)||(Math.abs(x)<1.22&&y>=32.3&&y<35.2))?-3.08:0;}
function moveWalk(dt){const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?22:5)*dt;const f=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown')),r=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));camera.position.x+=(-Math.sin(yaw)*f+Math.cos(yaw)*r)*speed;camera.position.z+=(-Math.cos(yaw)*f-Math.sin(yaw)*r)*speed;camera.position.y+=(Number(keys.has('KeyE'))-Number(keys.has('KeyQ')))*speed;camera.position.y=Math.max(groundHeight(camera.position)+1.7,camera.position.y)}
function tick(now){requestAnimationFrame(tick);const dt=Math.min(.05,(now-last)/1000);last=now;
 if(animation){const t=Math.min(1,(now-animation.start)/900),ease=t*t*(3-2*t);camera.position.lerpVectors(animation.fromP,animation.toP,ease);controls.target.lerpVectors(animation.fromT,animation.toT,ease);if(t===1)animation=null}
 if(mode==='orbit'){controls.update();camera.position.y=Math.max(groundHeight(camera.position)+.45,camera.position.y)}else {camera.rotation.set(pitch,yaw,0,'YXZ');moveWalk(dt)}
 if(ready){updateTrees();const dir=camera.getWorldDirection(new THREE.Vector3());for(const g of treeSets){g.top.visible=dir.y<-.3;g.side.visible=dir.y>-.9}}
 renderer.render(scene,camera);frames++;
 if(now-frameStart>1200){fps=Math.round(frames*1000/(now-frameStart));stats.fps=fps;stats.drawCalls=renderer.info.render.calls;stats.triangles=renderer.info.render.triangles;stats.position=camera.position.toArray();stats.mode=mode;$('status').textContent=ready?`V30 · Live 3D · ${fps} fps`:'Preparing…';frames=0;frameStart=now}
}
requestAnimationFrame(tick);
