export const clamp01 = (value: number) => Math.max(0,Math.min(1,value));
export const ease = (value: number) => {const t=clamp01(value);return t*t*(3-2*t);};
export const damp = (current: number,target: number,rate: number,dt: number) => current+(target-current)*(1-Math.exp(-rate*Math.max(0,dt)));
export const dampAngle = (current: number,target: number,rate: number,dt: number) => current+Math.atan2(Math.sin(target-current),Math.cos(target-current))*(1-Math.exp(-rate*Math.max(0,dt)));
