/** Keep a stable, sparser landscape without changing the source cache. */
export function isTree(name: string) {
  return /^(?:tree|dead tree|evergreen|oak(?: tree)?|willow(?: tree)?|yew(?: tree)?|maple tree|birch tree|pine tree|jungle tree|palm tree)$/i.test(name.trim());
}
export function retainTree(name: string,id: number,x: number,y: number,density: number) {
  if(!isTree(name)||density>=1)return true;
  if(density<=0)return false;
  const hash=(Math.imul(id+17,73856093)^Math.imul(x+31,19349663)^Math.imul(y+11,83492791))>>>0;
  return hash/4294967296<density;
}
