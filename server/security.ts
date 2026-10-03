export const MAX_REQUEST_BYTES = 1_100_000;

/** Apply headers at both adapters so errors and downloads receive the same protection. */
export function securityHeaders(url:string,document=false):Record<string,string> {
  return {
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy':document
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"
      : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    ...(new URL(url).protocol==='https:'?{'Strict-Transport-Security':'max-age=31536000'}:{})
  };
}

export function secureResponse(response:Response,url:string):Response {
  const headers=new Headers(response.headers);
  const document=headers.get('Content-Type')?.includes('text/html')??false;
  for(const [name,value] of Object.entries(securityHeaders(url,document)))headers.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
