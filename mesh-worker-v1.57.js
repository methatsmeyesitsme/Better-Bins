const cancelledMeshJobs=new Set();
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

function makePartSDF(p){
  const pos=p.position||[0,0,0],rot=p.rotation||[0,0,0],sc=p.scale||[1,1,1];
  const px=pos[0]||0,py=pos[1]||0,pz=pos[2]||0;
  const sx=Math.abs(sc[0]||1)||1,sy=Math.abs(sc[1]||1)||1,sz=Math.abs(sc[2]||1)||1;
  const rz=-(rot[2]||0),cz=Math.cos(rz),szn=Math.sin(rz);
  const ry=-(rot[1]||0),cy=Math.cos(ry),syn=Math.sin(ry);
  const rx=-(rot[0]||0),cx=Math.cos(rx),sxn=Math.sin(rx);
  const type=p.type;
  const size=p.size||[40,40,40], hx=(size[0]||40)/2,hy=(size[1]||40)/2,hz=(size[2]||40)/2;
  const radius=p.radius||20,radius2=p.radius2||10,height=p.height||40;
  const outerRadius=p.outerRadius||20,innerRadius=p.innerRadius||15;
  const majorRadius=p.majorRadius||20,minorRadius=p.minorRadius||5,length=p.length||40,depth=p.depth||20;
  const rr=type==="roundedBox"?Math.min(p.radius||4,hx,hy,hz):0;
  const pts=Array.isArray(p.points)?p.points:null;
  return (x,y,z)=>{
    let X=x-px,Y=y-py,Z=z-pz;
    let tx=X*cz-Y*szn,ty=X*szn+Y*cz,tz=Z;
    X=tx*cy+tz*syn;Z=-tx*syn+tz*cy;Y=ty;
    ty=Y*cx-Z*sxn;tz=Y*sxn+Z*cx;Y=ty;Z=tz;
    X/=sx;Y/=sy;Z/=sz;
    switch(type){
      case "sphere": return Math.hypot(X,Y,Z)-radius;
      case "cylinder":{
        const qx=Math.hypot(X,Y)-radius,qz=Math.abs(Z)-height/2;
        const ax=Math.max(qx,0),az=Math.max(qz,0);
        return Math.hypot(ax,az)+Math.min(Math.max(qx,qz),0);
      }
      case "tube":{
        const qo=cappedCylinderSDF(X,Y,Z,outerRadius,height/2),qi=cappedCylinderSDF(X,Y,Z,innerRadius,height/2+0.2);
        return Math.max(qo,-qi);
      }
      case "cone": return coneSDF(X,Y,Z,radius,radius2,height/2);
      case "torus": return torusSDF(X,Y,Z,majorRadius,minorRadius);
      case "capsule": return capsuleSDF(X,Y,Z,radius,length/2);
      case "roundedBox":{
        const qx=Math.abs(X)-(hx-rr),qy=Math.abs(Y)-(hy-rr),qz=Math.abs(Z)-(hz-rr);
        const ax=Math.max(qx,0),ay=Math.max(qy,0),az=Math.max(qz,0);
        return Math.hypot(ax,ay,az)+Math.min(Math.max(qx,Math.max(qy,qz)),0)-rr;
      }
      case "prism": return extrudedPolygonSDF(X,Y,Z,pts&&pts.length>=3?pts:[[-20,-20],[20,-20],[20,20],[-20,20]],depth);
      case "box":
      default: return Math.max(Math.abs(X)-hx,Math.max(Math.abs(Y)-hy,Math.abs(Z)-hz));
    }
  };
}
function partBounds(p){
  const pos=p.position||[0,0,0], sc=p.scale||[1,1,1];
  let r=10,z=10;
  switch(p.type){
    case "sphere": r=p.radius||20;z=r;break;
    case "cylinder":
    case "tube": r=Math.max(p.radius||p.outerRadius||20,p.innerRadius||0);z=(p.height||40)/2;break;
    case "cone": r=Math.max(p.radius||20,p.radius2||10);z=(p.height||40)/2;break;
    case "torus": r=(p.majorRadius||20)+(p.minorRadius||5);z=p.minorRadius||5;break;
    case "capsule": r=p.radius||10;z=(p.length||40)/2+r;break;
    case "box":
    case "roundedBox": r=Math.max((p.size?.[0]||40)/2,(p.size?.[1]||40)/2);z=(p.size?.[2]||40)/2;break;
    case "prism": r=0;for(const q of (p.points||[]))r=Math.max(r,Math.hypot(q[0],q[1]));z=(p.depth||20)/2;break;
    default:r=25;z=25;
  }
  const s=Math.max(Math.abs(sc[0]||1),Math.abs(sc[1]||1),Math.abs(sc[2]||1));
  r*=s;z*=s;
  return [[(pos[0]||0)-r,(pos[1]||0)-r,(pos[2]||0)-z],[(pos[0]||0)+r,(pos[1]||0)+r,(pos[2]||0)+z]];
}
function buildFieldAndBounds(spec){
  const parts=Array.isArray(spec.parts)&&spec.parts.length?spec.parts:[{type:"box",size:[40,40,40]}];
  const funcs=parts.map(makePartSDF);
  const bmin=[Infinity,Infinity,Infinity],bmax=[-Infinity,-Infinity,-Infinity];
  for(const p of parts){
    const b=partBounds(p);
    for(let a=0;a<3;a++){if(b[0][a]<bmin[a])bmin[a]=b[0][a];if(b[1][a]>bmax[a])bmax[a]=b[1][a];}
  }
  const base=(x,y,z)=>{
    let f=funcs[0](x,y,z);
    for(let i=1;i<funcs.length;i++){
      const v=funcs[i](x,y,z),op=parts[i].op||"union";
      if(op==="subtract")f=Math.max(f,-v);
      else if(op==="intersect")f=Math.max(f,v);
      else if(v<f)f=v;
    }
    return f;
  };
  const pattern=spec.pattern||"none";
  const span=Math.max(bmax[0]-bmin[0],bmax[1]-bmin[1],bmax[2]-bmin[2],1);
  const textureOn=!!spec.texture && Number(spec.textureAmount)>0;
  const textureAmount=Math.max(0,Math.min(100,Number(spec.textureAmount)||0))/100;
  const textureAmp=textureOn ? Math.min(3.5,Math.max(0.15,span*0.012)*textureAmount) : 0;
  const textureK=2*Math.PI*(6+textureAmount*8)/span;
  const texturedBase=(x,y,z)=>{
    if(!textureOn)return base(x,y,z);
    const sx=Math.sin(x*textureK),sy=Math.sin(y*textureK),sz=Math.sin(z*textureK);
    const bump=Math.pow(Math.max(0,(sx*sy*sz+1)/2),1.35);
    return base(x,y,z)-textureAmp*bump;
  };
  const wallOn=!!spec.walls && Number(spec.wallThickness)>0;
  const wallThickness=Math.max(0.2,Math.min(span/2,Number(spec.wallThickness)||0));
  const shell=wallOn ? (x,y,z)=>Math.max(texturedBase(x,y,z),-texturedBase(x,y,z)-wallThickness) : null;
  if(pattern==="none"){
    return{field:wallOn ? shell : texturedBase,bmin,bmax,pattern:null};
  }
  const k=2*Math.PI*(spec.periods||2.5)/span;
  const t=Math.max(0.15,(spec.thickness||1.5)*k/2);
  return{field:(x,y,z)=>{
    const lattice=Math.abs(
      pattern==="schwarzp"
        ? Math.cos(k*x)+Math.cos(k*y)+Math.cos(k*z)
        : pattern==="diamond"
          ? Math.sin(k*x)*Math.sin(k*y)*Math.sin(k*z)+Math.sin(k*x)*Math.cos(k*y)*Math.cos(k*z)+Math.cos(k*x)*Math.sin(k*y)*Math.cos(k*z)+Math.cos(k*x)*Math.cos(k*y)*Math.sin(k*z)
          : Math.sin(k*x)*Math.cos(k*y)+Math.sin(k*y)*Math.cos(k*z)+Math.sin(k*z)*Math.cos(k*x)
    )-t;
    const patternField=Math.max(texturedBase(x,y,z),lattice);
    return wallOn ? Math.min(patternField,shell(x,y,z)) : patternField;
  },bmin,bmax,pattern:{kind:pattern,k,t}};
}
function repairBoundaryLoops(tris){
 const n=Math.floor(tris.length/12),verts=[],map=new Map(),edges=new Map();
 const key=(x,y,z)=>Math.round(x*1000000)+','+Math.round(y*1000000)+','+Math.round(z*1000000);
 const vid=(x,y,z)=>{const k=key(x,y,z),v=map.get(k);if(v!==undefined)return v;const id=verts.length;verts.push([x,y,z]);map.set(k,id);return id;};
 const ae=(a,b,nx,ny,nz)=>{const lo=a<b?a:b,hi=a<b?b:a,k=lo+'_'+hi,e=edges.get(k);if(e){e.c++;e.nx+=nx;e.ny+=ny;e.nz+=nz;}else edges.set(k,{a:a,b:b,c:1,nx:nx,ny:ny,nz:nz});};
 for(let t=0;t<n;t++){const s=t*12,a=vid(tris[s+3],tris[s+4],tris[s+5]),b=vid(tris[s+6],tris[s+7],tris[s+8]),c=vid(tris[s+9],tris[s+10],tris[s+11]),nx=tris[s],ny=tris[s+1],nz=tris[s+2];ae(a,b,nx,ny,nz);ae(b,c,nx,ny,nz);ae(c,a,nx,ny,nz);}
 const be=[],adj=new Map();for(const e of edges.values())if(e.c===1){const id=be.length;be.push(e);let a=adj.get(e.a);if(!a){a=[];adj.set(e.a,a);}a.push(id);let b=adj.get(e.b);if(!b){b=[];adj.set(e.b,b);}b.push(id);}
 if(!be.length)return tris;for(const a of adj.values())if(a.length!==2)return tris;
 const used=new Uint8Array(be.length),out=Array.from(tris);
 for(let start=0;start<be.length;start++){if(used[start])continue;const first=be[start],loop=[first.a],ids=[start];used[start]=1;let cur=first.b,closed=false;
  loop.push(cur);for(let g=0;g<512;g++){const list=adj.get(cur)||[],next=list.find(id=>!used[id]);if(next===undefined){if(cur===loop[0])closed=true;break;}used[next]=1;ids.push(next);const e=be[next],other=e.a===cur?e.b:e.a;if(other===loop[0]){closed=true;break;}loop.push(other);cur=other;}
  if(!closed||loop.length<3)continue;let cx=0,cy=0,cz=0,nx=0,ny=0,nz=0;for(const id of loop){const v=verts[id];cx+=v[0];cy+=v[1];cz+=v[2];}for(const id of ids){const e=be[id];nx+=e.nx;ny+=e.ny;nz+=e.nz;}cx/=loop.length;cy/=loop.length;cz/=loop.length;const nl=Math.hypot(nx,ny,nz);if(nl<1e-12)continue;nx/=nl;ny/=nl;nz/=nl;
  for(let i=0;i<loop.length;i++){const a=verts[loop[i]],b=verts[loop[(i+1)%loop.length]],ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=cx-a[0],vy=cy-a[1],vz=cz-a[2];let tx=uy*vz-uz*vy,ty=uz*vx-ux*vz,tz=ux*vy-uy*vx,tl=Math.hypot(tx,ty,tz);if(tl<1e-12)continue;if(tx*nx+ty*ny+tz*nz<0){tx=-tx;ty=-ty;tz=-tz;}out.push(tx/tl,ty/tl,tz/tl,a[0],a[1],a[2],b[0],b[1],b[2],cx,cy,cz);}
 }
 return new Float32Array(out);
}
function addTriFast(tris,ax,ay,az,bx,by,bz,cx,cy,cz,dx,dy,dz){
  let ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  if(nx*nx+ny*ny+nz*nz<1e-12)return;
  if(nx*dx+ny*dy+nz*dz<0){const tx=bx,ty=by,tz=bz;bx=cx;by=cy;bz=cz;cx=tx;cy=ty;cz=tz;nx=-nx;ny=-ny;nz=-nz;}
  tris.push(nx,ny,nz,ax,ay,az,bx,by,bz,cx,cy,cz);
}
const tetEdgeA=[0,1,2,0,1,2],tetEdgeB=[1,2,0,3,3,3];
const tetA0=0,tetA1=5,tetA2=1,tetA3=6,tetB0=0,tetB1=1,tetB2=2,tetB3=6,tetC0=0,tetC1=2,tetC2=3,tetC3=6,tetD0=0,tetD1=3,tetD2=7,tetD3=6,tetE0=0,tetE1=7,tetE2=4,tetE3=6,tetF0=0,tetF1=4,tetF2=5,tetF3=6;
const ex=new Float64Array(4),ey=new Float64Array(4),ez=new Float64Array(4);
function processTetFast(a,b,c,d,xs,ys,zs,vs,tris){
  const va=vs[a],vb=vs[b],vc=vs[c],vd=vs[d];
  const mask=(va<0?1:0)|(vb<0?2:0)|(vc<0?4:0)|(vd<0?8:0);
  if(mask===0||mask===15)return;
  let nix=0,niy=0,niz=0,nox=0,noy=0,noz=0,nin=0,nout=0;
  const ax=xs[a],ay=ys[a],az=zs[a],bx=xs[b],by=ys[b],bz=zs[b],cx=xs[c],cy=ys[c],cz=zs[c],dx=xs[d],dy=ys[d],dz=zs[d];
  if(mask&1){nix+=ax;niy+=ay;niz+=az;nin++;}else{nox+=ax;noy+=ay;noz+=az;nout++;}
  if(mask&2){nix+=bx;niy+=by;niz+=bz;nin++;}else{nox+=bx;noy+=by;noz+=bz;nout++;}
  if(mask&4){nix+=cx;niy+=cy;niz+=cz;nin++;}else{nox+=cx;noy+=cy;noz+=cz;nout++;}
  if(mask&8){nix+=dx;niy+=dy;niz+=dz;nin++;}else{nox+=dx;noy+=dy;noz+=dz;nout++;}
  const dirx=nox/nout-nix/nin,diry=noy/nout-niy/nin,dirz=noz/nout-niz/nin;
  let count=0;
  for(let e=0;e<6;e++){
    const ea=tetEdgeA[e],eb=tetEdgeB[e],ma=1<<ea,mb=1<<eb;
    if(((mask&ma)!==0)===((mask&mb)!==0))continue;
    let p0x,p0y,p0z,f0,p1x,p1y,p1z,f1;
    if(ea===0){p0x=ax;p0y=ay;p0z=az;f0=va;}else if(ea===1){p0x=bx;p0y=by;p0z=bz;f0=vb;}else if(ea===2){p0x=cx;p0y=cy;p0z=cz;f0=vc;}else{p0x=dx;p0y=dy;p0z=dz;f0=vd;}
    if(eb===0){p1x=ax;p1y=ay;p1z=az;f1=va;}else if(eb===1){p1x=bx;p1y=by;p1z=bz;f1=vb;}else if(eb===2){p1x=cx;p1y=cy;p1z=cz;f1=vc;}else{p1x=dx;p1y=dy;p1z=dz;f1=vd;}
    const den=f0-f1,tt=Math.abs(den)<1e-9?0.5:f0/den;
    ex[count]=p0x+(p1x-p0x)*tt;ey[count]=p0y+(p1y-p0y)*tt;ez[count]=p0z+(p1z-p0z)*tt;count++;
  }
  if(count===3){
    addTriFast(tris,ex[0],ey[0],ez[0],ex[1],ey[1],ez[1],ex[2],ey[2],ez[2],dirx,diry,dirz);
  }else if(count===4){
    addTriFast(tris,ex[0],ey[0],ez[0],ex[1],ey[1],ez[1],ex[2],ey[2],ez[2],dirx,diry,dirz);
    addTriFast(tris,ex[0],ey[0],ez[0],ex[2],ey[2],ez[2],ex[3],ey[3],ez[3],dirx,diry,dirz);
  }
}
async function generateMesh(fieldFn,res,bmin,bmax,id,patternData){
  const N=res+1,xyN=N*N;
  const dx=(bmax[0]-bmin[0])/res,dy=(bmax[1]-bmin[1])/res,dz=(bmax[2]-bmin[2])/res;
  const xs=new Float32Array(N),ys=new Float32Array(N),zs=new Float32Array(N);
  for(let i=0;i<N;i++){
    if(cancelledMeshJobs.has(id)){cancelledMeshJobs.delete(id);return null;}xs[i]=bmin[0]+i*dx;ys[i]=bmin[1]+i*dy;zs[i]=bmin[2]+i*dz;}
  let psx,pcx,psy,pcy,psz,pcz;
  if(patternData){
    psx=new Float32Array(N);pcx=new Float32Array(N);psy=new Float32Array(N);pcy=new Float32Array(N);psz=new Float32Array(N);pcz=new Float32Array(N);
    for(let i=0;i<N;i++){
      const x=xs[i]*patternData.k,y=ys[i]*patternData.k,z=zs[i]*patternData.k;
      psx[i]=Math.sin(x);pcx[i]=Math.cos(x);psy[i]=Math.sin(y);pcy[i]=Math.cos(y);psz[i]=Math.sin(z);pcz[i]=Math.cos(z);
    }
  }
  const vals=new Float32Array(N*N*N);
  for(let i=0;i<N;i++){
    const x=xs[i],ibase=i*xyN;
    for(let j=0;j<N;j++){
      const y=ys[j],base=ibase+j*N;
      for(let k=0;k<N;k++){
        const z=zs[k],bv=fieldFn(x,y,z);
        if(!patternData){vals[base+k]=bv;continue;}
        let pf;
        if(patternData.kind==="schwarzp")pf=pcx[i]+pcy[j]+pcz[k];
        else if(patternData.kind==="diamond")pf=psx[i]*psy[j]*psz[k]+psx[i]*pcy[j]*pcz[k]+pcx[i]*psy[j]*pcz[k]+pcx[i]*pcy[j]*psz[k];
        else pf=psx[i]*pcy[j]+psy[j]*pcz[k]+psz[k]*pcx[i];
        vals[base+k]=Math.max(bv,Math.abs(pf)-patternData.t);
      }
    }
    if((i&3)===3)self.postMessage({type:"progress",id,value:Math.round((i+1)/res*35)});
  }
  const cx=new Float32Array(8),cy=new Float32Array(8),cz=new Float32Array(8),cv=new Float32Array(8),tris=[];
  for(let i=0;i<res;i++){
    if(cancelledMeshJobs.has(id)){cancelledMeshJobs.delete(id);return null;}
    const x0=xs[i],x1=xs[i+1],ibase=i*xyN,inext=(i+1)*xyN;
    for(let j=0;j<res;j++){
      const y0=ys[j],y1=ys[j+1],jbase=ibase+j*N,jnext=ibase+(j+1)*N,jnbase=inext+j*N,jnnext=inext+(j+1)*N;
      for(let k=0;k<res;k++){
        const base0=jbase+k,base1=jnbase+k,base2=jnext+k,base3=jnnext+k;
        cv[0]=vals[base0];cv[1]=vals[base1];cv[2]=vals[base3];cv[3]=vals[base2];
        cv[4]=vals[base0+1];cv[5]=vals[base1+1];cv[6]=vals[base3+1];cv[7]=vals[base2+1];

        let vmin=cv[0],vmax=cv[0];
        for(let q=1;q<8;q++){const v=cv[q];if(v<vmin)vmin=v;if(v>vmax)vmax=v;}
        if(vmin>0 || vmax<0)continue;

        const z0=zs[k],z1=zs[k+1];
        cx[0]=x0;cy[0]=y0;cz[0]=z0;
        cx[1]=x1;cy[1]=y0;cz[1]=z0;
        cx[2]=x1;cy[2]=y1;cz[2]=z0;
        cx[3]=x0;cy[3]=y1;cz[3]=z0;
        cx[4]=x0;cy[4]=y0;cz[4]=z1;
        cx[5]=x1;cy[5]=y0;cz[5]=z1;
        cx[6]=x1;cy[6]=y1;cz[6]=z1;
        cx[7]=x0;cy[7]=y1;cz[7]=z1;

        processTetFast(0,5,1,6,cx,cy,cz,cv,tris);
        processTetFast(0,1,2,6,cx,cy,cz,cv,tris);
        processTetFast(0,2,3,6,cx,cy,cz,cv,tris);
        processTetFast(0,3,7,6,cx,cy,cz,cv,tris);
        processTetFast(0,7,4,6,cx,cy,cz,cv,tris);
        processTetFast(0,4,5,6,cx,cy,cz,cv,tris);
      }
    }
    if((i&1)===1)self.postMessage({type:"progress",id,value:35+Math.round((i+1)/res*65)});
  }
  return repairBoundaryLoops(new Float32Array(tris));
}
function legacyPatternToSpec(p){
  let part;
  if(p.shape==="sphere")part={type:"sphere",radius:(p.diameter||50)/2,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"};
  else if(p.shape==="cylinder")part={type:"cylinder",radius:(p.diameter||50)/2,height:p.height||50,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"};
  else if(p.shape==="ring"){const minor=(p.tubeDiameter||16)/2,major=Math.max(minor+0.5,(p.outerDiameter||60)/2-minor);part={type:"torus",majorRadius:major,minorRadius:minor,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"};}
  else{const size=p.size||50;part=p.rounded?{type:"roundedBox",size:[size,size,size],radius:Math.min(p.cornerRadius||5,size/2),position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}:{type:"box",size:[size,size,size],position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"};}
  return{parts:[part],pattern:p.pattern||"gyroid",periods:Number(p.periods)||2.5,thickness:Number(p.thickness)||1.5,texture:!!p.texture,textureAmount:Number(p.textureAmount)||0,walls:!!p.walls,wallThickness:Number(p.wallThickness)||0};
}
self.onmessage=async(e)=>{
  const m=e.data||{};
  if(m.type==="cancel"){cancelledMeshJobs.add(m.id);return;}
  if(m.type!=="mesh")return;
  try{
    const spec=m.mode==="pattern"?legacyPatternToSpec(m.spec):m.spec;
    self.postMessage({type:"start",id:m.id,mode:m.mode});
    const built=buildFieldAndBounds(spec);
    const data=await generateMesh(built.field,Math.max(16,Math.min(48,Math.round(m.res||(m.mode==='pattern'?36:18)))),built.bmin,built.bmax,m.id,built.pattern);
    if(data===null){self.postMessage({type:"cancelled",id:m.id,mode:m.mode});return;}
    self.postMessage({type:"result",id:m.id,mode:m.mode,data},[data.buffer]);
  }catch(err){self.postMessage({type:"error",id:m.id,mode:m.mode,message:err?.message||String(err)});}
};
