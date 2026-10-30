import type { FaceField, FaceObservation, FaceStatus, FramePacket } from '../core/types';
import { continuousFace,faceGeometry } from './face-geometry';
import type { FaceRequest, FaceResponse } from './face-protocol';

/** Lazy, bounded face estimation. Never transfer the studio's bitmap or queue frames. */
export class FaceTracker {
  private worker?:Worker;
  private ready=false;
  private failed=false;
  private epoch=0;
  private id=0;
  private pending?:{id:number;epoch:number;timestamp:number;generation:number;started:number};
  private observation?:FaceObservation;
  private noFaceAt?:number;
  private lastAttempt=-Infinity;
  private lastFrame?:{timestamp:number;generation:number};
  private timer?:ReturnType<typeof setTimeout>;
  private status:FaceStatus='off';
  inferenceMs=0;
  private continuity=0;
  constructor(private notify:(status:FaceStatus,message?:string)=>void,private repaint:()=>void) {}
  private report(status:FaceStatus,message?:string) { if(status!==this.status||message) {this.status=status;this.notify(status,message);} }
  private initialize() {
    this.report('loading');
    const worker=this.worker=new Worker(new URL('./face.worker.ts',import.meta.url),{type:'module'});
    this.timer=setTimeout(()=>this.fail('The face model took too long to load. Retry face tracking.'),60_000);
    worker.onerror=event=>{event.preventDefault();if(this.worker===worker)this.fail(event.message||'Face tracking stopped. Retry face tracking.');};
    worker.onmessage=(event:MessageEvent<FaceResponse>)=>{
      if(this.worker!==worker)return;
      const result=event.data;
      if(result.type==='error'){this.fail(result.message);return;}
      if(result.type==='ready'){clearTimeout(this.timer);this.ready=true;this.repaint();return;}
      const request=this.pending;
      if(!request||result.id!==request.id||request.epoch!==this.epoch||result.generation!==request.generation||result.timestamp!==request.timestamp)return;
      clearTimeout(this.timer);this.pending=undefined;this.inferenceMs=result.inferenceMs;
      if(result.landmarks&&faceGeometry(result.landmarks,1,1)) {
        const observation={landmarks:result.landmarks,timestamp:result.timestamp,generation:result.generation,inferenceMs:result.inferenceMs};
        if(this.observation&&!continuousFace(this.observation,observation))this.continuity++;
        this.observation={...observation,continuity:this.continuity};
        this.noFaceAt=undefined;
      } else this.noFaceAt??=performance.now();
      this.repaint();
    };
    this.post({type:'initialize',baseUrl:new URL(import.meta.env.BASE_URL,location.href).href});
  }
  private post(message:FaceRequest,transfer:Transferable[]=[]) {this.worker!.postMessage(message,transfer);}
  update(frame:FramePacket,frozen=false):FaceField|undefined {
    const now=performance.now();
    if(this.lastFrame&&this.lastFrame.generation!==frame.generation)this.reset();
    this.lastFrame={timestamp:frame.timestamp,generation:frame.generation};
    if(this.failed)return;
    if(!this.worker)try{this.initialize();}catch(error){this.fail(String(error));return;}
    const already=this.pending?.timestamp===frame.timestamp&&this.pending.generation===frame.generation;
    const estimated=this.observation?.timestamp===frame.timestamp&&this.observation.generation===frame.generation;
    // A frozen no-face result is final too; don't repeatedly infer the same frame.
    const completed=this.completedFrame===`${frame.generation}:${frame.timestamp}`;
    if(this.ready&&!this.pending&&!already&&!estimated&&!completed&&now-this.lastAttempt>=1000/15) {
      this.lastAttempt=now;
      const request=this.pending={id:++this.id,epoch:this.epoch,timestamp:frame.timestamp,generation:frame.generation,started:now};
      const scale=Math.min(1,640/Math.max(frame.image.width,frame.image.height));
      void createImageBitmap(frame.image,{resizeWidth:Math.max(1,Math.round(frame.image.width*scale)),resizeHeight:Math.max(1,Math.round(frame.image.height*scale))}).then(image=>{
        if(!this.worker||this.pending!==request||request.epoch!==this.epoch){image.close();return;}
        this.timer=setTimeout(()=>this.fail('Face tracking stopped responding. Retry face tracking.'),15_000);
        this.post({type:'track',id:request.id,timestamp:request.timestamp,generation:request.generation,clock:performance.now(),image},[image]);
        this.completedFrame=`${request.generation}:${request.timestamp}`;
      }).catch(error=>{if(request.epoch===this.epoch)this.fail(String(error));});
    }
    const observation=this.observation;
    if(!observation||observation.generation!==frame.generation){if(this.ready)this.report(this.noFaceAt===undefined?'estimating':'no-face');return;}
    const age=frame.timestamp-observation.timestamp;
    const matching=frozen&&age===0;
    let strength=matching?1:Math.max(0,Math.min(1,(200-age)/80));
    if(age<0)strength=0;
    if(this.noFaceAt!==undefined)strength*=Math.max(0,1-(now-this.noFaceAt)/100);
    this.report(this.noFaceAt!==undefined?'no-face':strength?'tracking':'stale');
    return strength?{observation,strength,allowWarp:this.noFaceAt===undefined}:undefined;
  }
  private completedFrame='';
  get needsRepaint(){return Boolean(this.noFaceAt!==undefined&&performance.now()-this.noFaceAt<110);}
  reset() {
    this.epoch++;this.continuity++;this.observation=undefined;this.noFaceAt=undefined;this.lastFrame=undefined;this.completedFrame='';this.lastAttempt=-Infinity;
    // Terminate in-flight inference: old responses cannot occupy the new source's slot.
    clearTimeout(this.timer);this.worker?.terminate();this.worker=undefined;this.pending=undefined;this.ready=false;
  }
  private fail(message:string) {this.reset();this.failed=true;this.report('error',message);this.repaint();}
  dispose(){this.reset();this.failed=false;this.inferenceMs=0;this.report('off');}
}
