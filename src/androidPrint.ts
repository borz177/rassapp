import {Capacitor, registerPlugin} from '@capacitor/core';
import {Filesystem, Directory} from '@capacitor/filesystem';

const NativePrint=registerPlugin<{printPdf(options:{uri:string;title:string}):Promise<{closed:boolean}>}>('FinuchetPrint');
export const isAndroidNativePrint=()=>typeof window!=='undefined'&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android';
export const hasAndroidNativePrint=()=>isAndroidNativePrint()&&Capacitor.isPluginAvailable('FinuchetPrint');

/** Файл находится в закрытом кеше приложения и удаляется после закрытия
 * системной печати, в том числе после отмены или ошибки. */
export async function printAndroidPdf(blob:Blob,title:string):Promise<void>{
  if(!hasAndroidNativePrint())throw Object.assign(new Error('Для системной печати обновите приложение.'),{code:'PRINT_UPDATE_REQUIRED'});
  if(blob.size<5||blob.size>40*1024*1024)throw new Error('Не удалось подготовить PDF подходящего размера. Сохраните документ для печати.');
  const data=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();reader.onerror=()=>reject(new Error('Не удалось прочитать PDF.'));
    reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(blob);
  });
  const path=`print-jobs/${crypto.randomUUID()}.pdf`;
  try{
    const saved=await Filesystem.writeFile({path,data,directory:Directory.Cache,recursive:true});
    await NativePrint.printPdf({uri:saved.uri,title});
  }finally{await Filesystem.deleteFile({path,directory:Directory.Cache}).catch(()=>{});}
}
