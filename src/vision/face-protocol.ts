export type FaceRequest =
  | { type:'initialize'; baseUrl:string }
  | { type:'track'; id:number; timestamp:number; generation:number; clock:number; image:ImageBitmap };
export type FaceResponse =
  | { type:'ready' }
  | { type:'result'; id:number; timestamp:number; generation:number; landmarks?:Float32Array; inferenceMs:number }
  | { type:'error'; message:string };
