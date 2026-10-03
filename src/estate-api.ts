export class RequestError extends Error{constructor(message:string,public status:number){super(message);}}
export async function estateApi<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api${path}`,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...options.headers}});
  let data:T & {error?:string};try{data=await response.json();}catch{throw new RequestError('MeterWise is temporarily unavailable. Try again shortly.',response.status);}
  if(!response.ok)throw new RequestError(data.error??'This action could not be completed.',response.status);return data;
}
export const postEstate=(body:unknown)=>({method:'POST',body:JSON.stringify(body)});
