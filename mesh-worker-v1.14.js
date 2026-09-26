function roundedBox(x,y,z,hx,hy,hz,r){
  const qx=Math.abs(x)-hx, qy=Math.abs(y)-hy, qz=Math.abs(z)-hz;
  const ax=Math.max(qx,0), ay=Math.max(qy,0), az=Math.max(qz,0);
  const outside=Math.hypot(ax,ay,az);
  const inside=Math.min(Math.max(qx,Math.max(qy,qz)),0);
  return outside+inside-r;
}
function sphereSDF(x,y,z,R){ return Math.hypot(x,y,z)-R; }
function cappedCylinderSDF(x,y,z,R,halfH){
  const qx=Math.hypot(x,y)-R, qz=Math.abs(z)-halfH;
  const ax=Math.max(qx,0), az=Math.max(qz,0);
  return Math.hypot(ax,az)+Math.min(Math.max(qx,qz),0);
}
function capsuleSDF(x,y,z,R,halfLen){
  const qz=Math.max(Math.abs(z)-halfLen,0);
  return Math.hypot(Math.hypot(x,y),qz)-R;
}
function torusSDF(x,y,z,Rm,rm){
  return Math.hypot(Math.hypot(x,y)-Rm,z)-rm;
}
function coneSDF(x,y,z,r1,r2,halfH){
  const h=halfH*2;
  const qz=z+halfH;
  const t=Math.max(0,Math.min(1,qz/h));
  const r=r1+(r2-r1)*t;
  const radial=Math.hypot(x,y)-r;
  const cap=Math.max(Math.abs(z)-halfH,0);
  return Math.hypot(Math.max(radial,0),cap)+Math.min(Math.max(radial,Math.abs(z)-halfH),0);
}
function pointSegmentDistance2D(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay;
  const l2=dx*dx+dy*dy;
  if(!l2) return Math.hypot(px-ax,py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function polygonSDF2D(x,y,pts){
  let inside=false, minD=Infinity;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const a=pts[i],b=pts[j];
    minD=Math.min(minD,pointSegmentDistance2D(x,y,a[0],a[1],b[0],b[1]));
    if(((a[1]>y)!==(b[1]>y)) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1]+1e-12)+a[0]) inside=!inside;
  }
  return inside ? -minD : minD;
}
function extrudedPolygonSDF(x,y,z,pts,depth){
  const d2=polygonSDF2D(x,y,pts), dz=Math.abs(z)-depth/2;
  return Math.hypot(Math.max(d2,0),Math.max(dz,0))+Math.min(Math.max(d2,dz),0);
}
function inverseRotate(x,y,z,rot){
  let X=x,Y=y,Z=z;
  const rz=-(rot[2]||0), cz=Math.cos(rz), sz=Math.sin(rz);
  [X,Y]=[X*cz-Y*sz,X*sz+Y*cz];
  const ry=-(rot[1]||0), cy=Math.cos(ry), sy=Math.sin(ry);
  [X,Z]=[X*cy+Z*sy,-X*sy+Z*cy];
  const rx=-(rot[0]||0), cx=Math.cos(rx), sx=Math.sin(rx);
  [Y,Z]=[Y*cx-Z*sx,Y*sx+Z*cx];
  return [X,Y,Z];
}
function transformLocal(x,y,z,p){
  const pos=p.position||[0,0,0], rot=p.rotation||[0,0,0], sc=p.scale||[1,1,1];
  x-=pos[0]||0; y-=pos[1]||0; z-=pos[2]||0;
  [x,y,z]=inverseRotate(x,y,z,rot);
  x/=Math.abs(sc[0]||1); y/=Math.abs(sc[1]||1); z/=Math.abs(sc[2]||1);
  return [x,y,z];
}
function partBounds(p){
  const pos=p.position||[0,0,0], sc=p.scale||[1,1,1];
  let r=10, z=10;
  switch(p.type){
    case 'sphere': r=p.radius||20; z=r; break;
    case 'cylinder': case 'tube': r=(p.radius||20); z=(p.height||40)/2; break;
    case 'cone': r=Math.max(p.radius||20,p.radius2||10); z=(p.height||40)/2; break;
    case 'torus': r=(p.majorRadius||20)+(p.minorRadius||5); z=p.minorRadius||5; break;
    case 'capsule': r=p.radius||10; z=(p.length||40)/2+r; break;
    case 'box': case 'roundedBox': r=(p.size?.[0]||40)/2; z=(p.size?.[2]||40)/2; r=Math.max(r,(p.size?.[1]||40)/2); break;
    case 'prism': r=0; for(const q of (p.points||[])) r=Math.max(r,Math.hypot(q[0],q[1])); z=(p.depth||20)/2; break;
    default: r=25; z=25;
  }
  const s=Math.max(Math.abs(sc[0]||1),Math.abs(sc[1]||1),Math.abs(sc[2]||1));
  r*=s; z*=s;
  return [[pos[0]-r,pos[1]-r,pos[2]-z],[pos[0]+r,pos[1]+r,pos[2]+z]];
}
function makePartSDF(p){
  return (x,y,z)=>{
    [x,y,z]=transformLocal(x,y,z,p);
    switch(p.type){
      case 'sphere': return sphereSDF(x,y,z,p.radius||20);
      case 'cylinder': return cappedCylinderSDF(x,y,z,p.radius||20,(p.height||40)/2);
      case 'tube': return Math.max(cappedCylinderSDF(x,y,z,p.outerRadius||20,(p.height||40)/2),-cappedCylinderSDF(x,y,z,p.innerRadius||15,(p.height||40)/2+0.2));
      case 'cone': return coneSDF(x,y,z,p.radius||20,p.radius2||10,(p.height||40)/2);
      case 'torus': return torusSDF(x,y,z,p.majorRadius||20,p.minorRadius||5);
      case 'capsule': return capsuleSDF(x,y,z,p.radius||10,(p.length||40)/2);
      case 'roundedBox': {
        const s=p.size||[40,40,40], rr=Math.min(p.radius||4,s[0]/2,s[1]/2,s[2]/2);
        return roundedBox(x,y,z,s[0]/2-rr,s[1]/2-rr,s[2]/2-rr,rr);
      }
      case 'box': default: {
        const s=p.size||[40,40,40];
        return Math.max(Math.abs(x)-s[0]/2,Math.max(Math.abs(y)-s[1]/2,Math.abs(z)-s[2]/2));
      }
      case 'prism': return extrudedPolygonSDF(x,y,z,p.points||[[-20,-20],[20,-20],[20,20],[-20,20]],p.depth||20);
    }
  };
}
function buildFieldAndBounds(spec){
  const parts=Array.isArray(spec.parts)&&spec.parts.length?spec.parts:[{type:'box',size:[40,40,40]}];
  const funcs=parts.map(makePartSDF);
  let bmin=[Infinity,Infinity,Infinity], bmax=[-Infinity,-Infinity,-Infinity];
  parts.forEach(p=>{
    const [lo,hi]=partBounds(p);
    for(let i=0;i<3;i++){ bmin[i]=Math.min(bmin[i],lo[i]); bmax[i]=Math.max(bmax[i],hi[i]); }
  });
  const base=(x,y,z)=>{
    let f=Infinity;
    for(let i=0;i<funcs.length;i++){
      const v=funcs[i](x,y,z), op=parts[i].op||'union';
      if(i===0 || op==='union') f=(i===0?Math.min(f,v):Math.min(f,v));
      else if(op==='subtract') f=Math.max(f,-v);
      else if(op==='intersect') f=Math.max(f,v);
    }
    return f;
  };
  const pattern=spec.pattern||'none';
  if(pattern==='none') return {field:base,bmin,bmax};
  const span=Math.max(bmax[0]-bmin[0],bmax[1]-bmin[1],bmax[2]-bmin[2],1);
  const k=2*Math.PI*(spec.periods||2.5)/span;
  const pf = pattern==='schwarzp'
    ? (x,y,z)=>Math.cos(k*x)+Math.cos(k*y)+Math.cos(k*z)
    : pattern==='diamond'
      ? (x,y,z)=>Math.sin(k*x)*Math.sin(k*y)*Math.sin(k*z)+Math.sin(k*x)*Math.cos(k*y)*Math.cos(k*z)+Math.cos(k*x)*Math.sin(k*y)*Math.cos(k*z)+Math.cos(k*x)*Math.cos(k*y)*Math.sin(k*z)
      : (x,y,z)=>Math.sin(k*x)*Math.cos(k*y)+Math.sin(k*y)*Math.cos(k*z)+Math.sin(k*z)*Math.cos(k*x);
  const t=Math.max(0.15,(spec.thickness||1.5)/Math.max(span,1)*k*span/2);
  return {field:(x,y,z)=>Math.max(base(x,y,z),Math.abs(pf(x,y,z))-t),bmin,bmax};
}
// ---- Marching tetrahedra ----
function addTri(tris,a,b,c,dir){
  let ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2];
  let vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  if(nx*dir[0]+ny*dir[1]+nz*dir[2]<0){const t=b;b=c;c=t;nx=-nx;ny=-ny;nz=-nz;}
  const len=Math.hypot(nx,ny,nz)||1;
  tris.push(nx/len,ny/len,nz/len,a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
}
function interp(p0,p1,f0,f1){
  const t = f0/(f0-f1);
  return [p0[0]+(p1[0]-p0[0])*t, p0[1]+(p1[1]-p0[1])*t, p0[2]+(p1[2]-p0[2])*t];
}
function avg(pts,idxs){
  let sx=0,sy=0,sz=0;
  idxs.forEach(i=>{sx+=pts[i][0];sy+=pts[i][1];sz+=pts[i][2];});
  const n=idxs.length;
  return [sx/n,sy/n,sz/n];
}
function processTet(pts,vals,tris){
  const inside = vals.map(v=>v<0);
  const insideIdx=[], outsideIdx=[];
  for(let i=0;i<4;i++) (inside[i]?insideIdx:outsideIdx).push(i);
  const cnt = insideIdx.length;
  if(cnt===0||cnt===4) return;
  const ic = avg(pts, insideIdx.length? insideIdx : [0]);
  const oc = avg(pts, outsideIdx.length? outsideIdx : [0]);
  const dir = [oc[0]-ic[0], oc[1]-ic[1], oc[2]-ic[2]];
  if(cnt===1 || cnt===3){
    const lone = cnt===1 ? insideIdx[0] : outsideIdx[0];
    const others = [0,1,2,3].filter(i=>i!==lone);
    const a = interp(pts[lone],pts[others[0]],vals[lone],vals[others[0]]);
    const b = interp(pts[lone],pts[others[1]],vals[lone],vals[others[1]]);
    const c = interp(pts[lone],pts[others[2]],vals[lone],vals[others[2]]);
    addTri(tris,a,b,c,dir);
  } else {
    const i0=insideIdx[0], i1=insideIdx[1], o0=outsideIdx[0], o1=outsideIdx[1];
    const p00=interp(pts[i0],pts[o0],vals[i0],vals[o0]);
    const p01=interp(pts[i0],pts[o1],vals[i0],vals[o1]);
    const p10=interp(pts[i1],pts[o0],vals[i1],vals[o0]);
    const p11=interp(pts[i1],pts[o1],vals[i1],vals[o1]);
    addTri(tris,p00,p01,p11,dir);
    addTri(tris,p00,p11,p10,dir);
  }
}
const tetIdx=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const cubeOff=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
async function generateMesh(fieldFn,res,bmin,bmax,id){
  const N=res+1,dx=(bmax[0]-bmin[0])/res,dy=(bmax[1]-bmin[1])/res,dz=(bmax[2]-bmin[2])/res;
  const vals=new Float32Array(N*N*N);
  for(let i=0;i<N;i++){
    const x=bmin[0]+i*dx;
    for(let j=0;j<N;j++){const y=bmin[1]+j*dy;for(let k=0;k<N;k++){const z=bmin[2]+k*dz;vals[(i*N+j)*N+k]=fieldFn(x,y,z);}}
    if((i&3)===3) self.postMessage({type:"progress",id,value:Math.round((i+1)/res*35)});
  }
  function idx(i,j,k){return(i*N+j)*N+k;}
  function pt(i,j,k){return[bmin[0]+i*dx,bmin[1]+j*dy,bmin[2]+k*dz];}
  const tris=[];
  for(let i=0;i<res;i++){
    for(let j=0;j<res;j++){
      for(let k=0;k<res;k++){
        const cp=[],cv=[];
        for(let q=0;q<8;q++){const oi=i+cubeOff[q][0],oj=j+cubeOff[q][1],ok=k+cubeOff[q][2];cp.push(pt(oi,oj,ok));cv.push(vals[idx(oi,oj,ok)]);}
        for(let t=0;t<6;t++){const ti=tetIdx[t];processTet([cp[ti[0]],cp[ti[1]],cp[ti[2]],cp[ti[3]]],[cv[ti[0]],cv[ti[1]],cv[ti[2]],cv[ti[3]]],tris);}
      }
    }
    if((i&1)===1) self.postMessage({type:"progress",id,value:35+Math.round((i+1)/res*65)});
  }
  return new Float32Array(tris);
}
function legacyPatternToSpec(p){
  let part;
  if(p.shape==='sphere')part={type:'sphere',radius:(p.diameter||50)/2,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:'union'};
  else if(p.shape==='cylinder')part={type:'cylinder',radius:(p.diameter||50)/2,height:p.height||50,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:'union'};
  else if(p.shape==='ring'){const minor=(p.tubeDiameter||16)/2,major=Math.max(minor+0.5,(p.outerDiameter||60)/2-minor);part={type:'torus',majorRadius:major,minorRadius:minor,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:'union'};}
  else{const size=p.size||50;part=p.rounded?{type:'roundedBox',size:[size,size,size],radius:Math.min(p.cornerRadius||5,size/2),position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:'union'}:{type:'box',size:[size,size,size],position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:'union'};}
  return{parts:[part],pattern:p.pattern||'gyroid',periods:Number(p.periods)||2.5,thickness:Number(p.thickness)||1.5};
}
self.onmessage=async(e)=>{
  const m=e.data||{};if(m.type!=="mesh")return;
  try{
    const spec=m.mode==="pattern"?legacyPatternToSpec(m.spec):m.spec;
    self.postMessage({type:"start",id:m.id,mode:m.mode});
    const built=buildFieldAndBounds(spec);
    const data=await generateMesh(built.field,Math.max(24,Math.min(48,Math.round(m.res||36))),built.bmin,built.bmax,m.id);
    self.postMessage({type:"result",id:m.id,mode:m.mode,data},[data.buffer]);
  }catch(err){self.postMessage({type:"error",id:m.id,mode:m.mode,message:err?.message||String(err)});}
};
