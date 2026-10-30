/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceRequest, FaceResponse } from './face-protocol';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let tracker:FaceLandmarker|undefined;
function reply(message:FaceResponse,transfer:Transferable[]=[]) { scope.postMessage(message,transfer); }
scope.onmessage=async(event:MessageEvent<FaceRequest>)=>{
  const message=event.data;
  try {
    if(message.type==='initialize') {
      const runtime=await FilesetResolver.forVisionTasks(`${message.baseUrl}vision/wasm`,true);
      const response=await fetch(`${message.baseUrl}vision/face_landmarker.task`);
      if(!response.ok) throw new Error('Face model is missing. Run pnpm models:setup -- --face, then retry.');
      const bytes=new Uint8Array(await response.arrayBuffer());
      // Task bundles can have a short prefix before the ZIP local-file header.
      if(bytes.length<1_000_000||![0,2].some(i=>bytes[i]===0x50&&bytes[i+1]===0x4b&&bytes[i+2]===3&&bytes[i+3]===4))
        throw new Error('Face model is missing or invalid. Run pnpm models:setup -- --face, then retry.');
      tracker=await FaceLandmarker.createFromOptions(runtime,{baseOptions:{modelAssetBuffer:bytes,delegate:'CPU'},runningMode:'VIDEO',numFaces:1,
        minFaceDetectionConfidence:0.6,minFacePresenceConfidence:0.6,minTrackingConfidence:0.5,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false});
      reply({type:'ready'});return;
    }
    if(!tracker) throw new Error('Face tracking has not initialized.');
    const start=performance.now(),result=tracker.detectForVideo(message.image,message.clock);
    const landmarks=result.faceLandmarks[0]?Float32Array.from(result.faceLandmarks[0].flatMap(p=>[p.x,p.y,p.z])):undefined;
    reply({type:'result',id:message.id,timestamp:message.timestamp,generation:message.generation,landmarks,inferenceMs:performance.now()-start},landmarks?[landmarks.buffer]:[]);
  } catch(error) {reply({type:'error',message:error instanceof Error?error.message:String(error)});}
  finally {if(message.type==='track') message.image.close();}
};
