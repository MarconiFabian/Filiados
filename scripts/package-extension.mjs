import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function zipStored(entries) {
  const utf8 = text => {
    const bytes=[];
    for(const ch of text){
      const c=ch.codePointAt(0);
      if(c<128)bytes.push(c);
      else if(c<2048)bytes.push(192|(c>>6),128|(c&63));
      else if(c<65536)bytes.push(224|(c>>12),128|((c>>6)&63),128|(c&63));
      else bytes.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));
    }
    return bytes;
  };
  const crc32=bytes=>{
    let crc=0xffffffff;
    for(const byte of bytes){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    return (crc^0xffffffff)>>>0;
  };
  const output=[],directory=[];
  const u16=(out,n)=>out.push(n&255,(n>>>8)&255);
  const u32=(out,n)=>{u16(out,n&65535);u16(out,n>>>16);};
  const append=(out,values)=>{for(const n of values)out.push(n);};
  for(const [name,text] of entries){
    const filename=utf8(name),data=utf8(text),crc=crc32(data),offset=output.length;
    u32(output,0x04034b50);u16(output,20);u16(output,0x0800);u16(output,0);u16(output,0);u16(output,33);
    u32(output,crc);u32(output,data.length);u32(output,data.length);u16(output,filename.length);u16(output,0);
    append(output,filename);append(output,data);
    u32(directory,0x02014b50);u16(directory,20);u16(directory,20);u16(directory,0x0800);u16(directory,0);u16(directory,0);u16(directory,33);
    u32(directory,crc);u32(directory,data.length);u32(directory,data.length);u16(directory,filename.length);
    for(let i=0;i<4;i++)u16(directory,0);
    u32(directory,0);u32(directory,offset);append(directory,filename);
  }
  const offset=output.length;append(output,directory);
  u32(output,0x06054b50);u16(output,0);u16(output,0);u16(output,entries.length);u16(output,entries.length);
  u32(output,directory.length);u32(output,offset);u16(output,0);
  return new Uint8Array(output);
}
export async function buildArchive() {
  const names=(await readdir('chrome-extension')).filter(n=>/\.(?:js|json|html|css|md)$/.test(n)).sort();
  const entries=await Promise.all(names.map(async n=>[n,await readFile('chrome-extension/'+n,'utf8')]));
  return Buffer.from(zipStored(entries));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const manifest=JSON.parse(await readFile('chrome-extension/manifest.json','utf8'));
  const archive=await buildArchive();
  const path='public/ml-afiliados-sender-v'+manifest.version+'.zip.b64';
  if(process.argv.includes('--check')){
    const committed=Buffer.from((await readFile(path,'utf8')).replace(/\s/g,''),'base64');
    if(!committed.equals(archive))throw new Error('Extension package differs from source. Run npm run extension:package');
    console.log('Every packaged extension file matches source.');
  }else await writeFile(path,archive.toString('base64')+'\n');
}
