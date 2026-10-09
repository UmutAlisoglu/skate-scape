import type { Rail } from '../game/skater.ts';

/** Merge touching collinear pieces so tile boundaries never interrupt a grind. */
export function joinRails(rails: Rail[]): Rail[] {
  const groups=new Map<string,Rail[]>();
  for(const rail of rails) {
    const dx=rail.b.x-rail.a.x,dz=rail.b.z-rail.a.z,axis=Math.abs(dx)>Math.abs(dz)?'x':'z';
    if((axis==='x'?Math.abs(dz):Math.abs(dx))>0.05||Math.abs(rail.a.y-rail.b.y)>0.05){groups.set(`single:${rail.id}`,[rail]);continue;}
    const across=axis==='x'?(rail.a.z+rail.b.z)/2:(rail.a.x+rail.b.x)/2;
    const key=`${axis}:${Math.round(across*16)}:${Math.round(rail.a.y*16)}`;
    let group=groups.get(key);if(!group)groups.set(key,group=[]);group.push(rail);
  }
  const result:Rail[]=[];
  for(const [key,group] of groups) {
    if(key.startsWith('single:')){result.push(...group);continue;}
    const axis=key[0] as 'x'|'z';
    const ordered=group.map(r=>({...r,a:r.a[axis]<=r.b[axis]?r.a:r.b,b:r.a[axis]<=r.b[axis]?r.b:r.a}))
      .sort((a,b)=>a.a[axis]-b.a[axis]);
    let current={...ordered[0],a:{...ordered[0].a},b:{...ordered[0].b}};
    for(const next of ordered.slice(1)) {
      if(next.a[axis]-current.b[axis]<=0.28&&Math.abs(next.a.y-current.b.y)<0.08) {
        if(next.b[axis]>current.b[axis])current.b={...next.b};
        current.width=Math.max(current.width??0.08,next.width??0.08);
      } else {result.push(current);current={...next,a:{...next.a},b:{...next.b}};}
    }
    result.push(current);
  }
  return result;
}
