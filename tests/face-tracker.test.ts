import { afterEach,describe,expect,it,vi } from 'vitest';
import { FaceTracker } from '../src/vision/face';
import { authoredFace } from '../src/vision/face-geometry';
import type { FaceRequest,FaceResponse } from '../src/vision/face-protocol';
class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage?:(event:{data:FaceResponse})=>void;
  sent:FaceRequest[]=[];terminate=vi.fn();
  constructor(){FakeWorker.instances.push(this);}
  postMessage(message:FaceRequest){this.sent.push(message);}
  reply(data:FaceResponse){this.onmessage?.({data});}
}
afterEach(()=>{vi.unstubAllGlobals();FakeWorker.instances=[];});
function setup(){
  let clock=100;
  vi.stubGlobal('performance',{now:()=>clock});vi.stubGlobal('Worker',FakeWorker);vi.stubGlobal('location',{href:'http://localhost/'});
  const image={width:1280,height:720,close:vi.fn()} as unknown as ImageBitmap;
  const copy={close:vi.fn()} as unknown as ImageBitmap;
  const bitmap=vi.fn(async()=>copy);vi.stubGlobal('createImageBitmap',bitmap);
  const notify=vi.fn(),tracker=new FaceTracker(notify,vi.fn()),frame={image,timestamp:100,generation:1};
  return {tracker,notify,frame,copy,bitmap,time:(value:number)=>{clock=value;}};
}
describe('bounded nonblocking face tracker',()=>{
  it('loads lazily, uses one copy, limits cadence, and preserves bitmap ownership',async()=>{
    const {tracker,frame,bitmap,time}=setup();
    expect(FakeWorker.instances).toHaveLength(0);
    tracker.update(frame);const worker=FakeWorker.instances[0];
    tracker.update({...frame,timestamp:120});expect(bitmap).not.toHaveBeenCalled();
    worker.reply({type:'ready'});tracker.update(frame);await Promise.resolve();
    expect(bitmap).toHaveBeenCalledWith(frame.image,{resizeWidth:640,resizeHeight:360});
    tracker.update({...frame,timestamp:130});expect(worker.sent).toHaveLength(2);
    worker.reply({type:'result',id:1,timestamp:100,generation:1,landmarks:authoredFace(.5,.5,.3,.5).landmarks,inferenceMs:12});
    expect(tracker.update({...frame,timestamp:140})?.strength).toBe(1);
    expect(worker.sent).toHaveLength(2);time(180);tracker.update({...frame,timestamp:180});await Promise.resolve();
    expect(worker.sent).toHaveLength(3);expect(frame.image.close).not.toHaveBeenCalled();tracker.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('expires live estimates, holds an exact frozen result, and fades no-face without warping',async()=>{
    const {tracker,frame,time}=setup();tracker.update(frame);const worker=FakeWorker.instances[0];worker.reply({type:'ready'});
    tracker.update(frame);await Promise.resolve();worker.reply({type:'result',id:1,timestamp:100,generation:1,landmarks:authoredFace(.5,.5,.3,.5).landmarks,inferenceMs:10});
    expect(tracker.update({...frame,timestamp:260})?.strength).toBeCloseTo(.5);
    expect(tracker.update({...frame,timestamp:300})).toBeUndefined();
    time(5000);expect(tracker.update(frame,true)?.strength).toBe(1);
    tracker.update({...frame,timestamp:150});await Promise.resolve();worker.reply({type:'result',id:2,timestamp:150,generation:1,inferenceMs:10});
    expect(tracker.update({...frame,timestamp:150})?.allowWarp).toBe(false);time(5050);
    expect(tracker.update({...frame,timestamp:150})?.strength).toBeCloseTo(.5);time(5101);
    expect(tracker.update({...frame,timestamp:150})).toBeUndefined();tracker.dispose();
  });
  it('drops late source replies, closes obsolete copies, recovers from errors, and freezes no-face results',async()=>{
    const {tracker,frame,notify,bitmap,copy,time}=setup();tracker.update(frame);const old=FakeWorker.instances[0];old.reply({type:'ready'});
    let finish!:(value:ImageBitmap)=>void;bitmap.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    tracker.update(frame);tracker.dispose();finish(copy);await Promise.resolve();expect(copy.close).toHaveBeenCalledOnce();
    tracker.update({...frame,generation:2});const current=FakeWorker.instances[1];
    old.reply({type:'error',message:'obsolete'});expect(notify).not.toHaveBeenCalledWith('error','obsolete');
    current.reply({type:'ready'});tracker.update({...frame,generation:2});await Promise.resolve();
    current.reply({type:'result',id:2,timestamp:100,generation:2,inferenceMs:2});time(1000);
    tracker.update({...frame,generation:2},true);expect(current.sent).toHaveLength(2);
    current.reply({type:'error',message:'missing model'});expect(notify).toHaveBeenCalledWith('error','missing model');
    tracker.update(frame);expect(FakeWorker.instances).toHaveLength(2);tracker.dispose();tracker.update(frame);expect(FakeWorker.instances).toHaveLength(3);tracker.dispose();
  });
  it('clears pending inference automatically on a source generation change',async()=>{
    const {tracker,frame}=setup();tracker.update(frame);const old=FakeWorker.instances[0];old.reply({type:'ready'});
    tracker.update(frame);await Promise.resolve();
    const next={...frame,generation:2};expect(tracker.update(next)).toBeUndefined();expect(old.terminate).toHaveBeenCalledOnce();
    old.reply({type:'result',id:1,timestamp:100,generation:1,landmarks:authoredFace(.5,.5,.3,.5).landmarks,inferenceMs:5});
    const worker=FakeWorker.instances[1];worker.reply({type:'ready'});tracker.update(next);await Promise.resolve();
    worker.reply({type:'result',id:2,timestamp:100,generation:2,landmarks:authoredFace(.5,.5,.3,.5).landmarks,inferenceMs:6});
    expect(tracker.update(next,true)?.observation.generation).toBe(2);tracker.dispose();
  });
});
