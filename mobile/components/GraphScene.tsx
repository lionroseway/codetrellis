/**
 * GraphScene — an interactive, visual dependency graph rendered with a
 * self-contained canvas force-layout inside a WebView (offline, no CDN).
 *
 * The desktop streams a cluster-level scene over the `graph.scene` RPC
 * (directory clusters as nodes, aggregated imports as edges) plus per-node
 * state so we can colour Live / Planned / Diverged:
 *   normal · changed (diverged) · planned_add · planned_modify · planned_remove
 *
 * Touch: one-finger drag pans, two-finger pinch zooms, tapping a node posts
 * its id back so the host can drill into that directory.
 *
 * Bridge:
 *   RN → WebView : window.__scene(jsonString)   ({nodes,edges})
 *   WebView → RN : postMessage                  ({type:'tap', id} | {type:'ready'})
 */

import { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { StyleSheet } from 'react-native';

export interface SceneNode {
  id: string;
  label: string;
  fileCount: number;
  state: 'normal' | 'changed' | 'planned_add' | 'planned_modify' | 'planned_remove';
}
export interface SceneEdge { source: string; target: string; weight: number }

export interface GraphSceneHandle {
  setScene: (nodes: SceneNode[], edges: SceneEdge[]) => void;
}

interface GraphSceneProps {
  onReady?: () => void;
  onTapNode?: (id: string) => void;
}

const GraphScene = forwardRef<GraphSceneHandle, GraphSceneProps>(function GraphScene(
  { onReady, onTapNode },
  ref,
) {
  const webRef = useRef<WebView>(null);

  const inject = useCallback((nodes: SceneNode[], edges: SceneEdge[]) => {
    const payload = JSON.stringify({ nodes, edges }).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    webRef.current?.injectJavaScript(`window.__scene && window.__scene('${payload}'); true;`);
  }, []);

  useImperativeHandle(ref, () => ({
    setScene: (nodes, edges) => inject(nodes, edges),
  }), [inject]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') onReady?.();
      else if (msg.type === 'tap' && typeof msg.id === 'string') onTapNode?.(msg.id);
    } catch { /* ignore */ }
  }, [onReady, onTapNode]);

  return (
    <WebView
      ref={webRef}
      style={styles.web}
      originWhitelist={['*']}
      source={{ html: SCENE_HTML }}
      onMessage={onMessage}
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      javaScriptEnabled
      domStorageEnabled
      androidLayerType="hardware"
    />
  );
});

export default GraphScene;

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#09090b' },
});

// Self-contained renderer. Force layout + canvas draw + touch pan/zoom/tap.
const SCENE_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;padding:0;height:100%;background:#09090b;overflow:hidden;touch-action:none;}
  #c{display:block;width:100vw;height:100vh;}
  #empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#52525b;font:13px -apple-system,sans-serif;}
</style></head><body>
<canvas id="c"></canvas>
<div id="empty">Loading graph…</div>
<script>
(function(){
  var RN = window.ReactNativeWebView;
  function send(o){ try{ RN && RN.postMessage(JSON.stringify(o)); }catch(e){} }
  var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
  var DPR = window.devicePixelRatio || 1;
  var W=0,H=0;
  function resize(){ W=window.innerWidth; H=window.innerHeight; canvas.width=W*DPR; canvas.height=H*DPR; canvas.style.width=W+'px'; canvas.style.height=H+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); }
  resize(); window.addEventListener('resize', resize);

  var COLORS = {
    normal:'#3b82f6', changed:'#f59e0b',
    planned_add:'#22c55e', planned_modify:'#eab308', planned_remove:'#ef4444'
  };
  var nodes=[], edges=[], byId={};
  var tx=0, ty=0, scale=1;       // pan/zoom transform
  var alpha=0;                    // simulation energy

  function radius(n){ return Math.max(9, Math.min(34, 8 + Math.sqrt(n.fileCount||1)*4)); }

  window.__scene = function(json){
    try{ var s = JSON.parse(json); }catch(e){ return; }
    var prev = byId;
    nodes = (s.nodes||[]).map(function(n){
      var p = prev[n.id];
      return { id:n.id, label:n.label||n.id, fileCount:n.fileCount||0, state:n.state||'normal',
               x: p? p.x : (W/2 + (Math.random()-0.5)*W*0.6),
               y: p? p.y : (H/2 + (Math.random()-0.5)*H*0.6), vx:0, vy:0 };
    });
    byId = {}; nodes.forEach(function(n){ byId[n.id]=n; });
    edges = (s.edges||[]).filter(function(e){ return byId[e.source] && byId[e.target]; });
    document.getElementById('empty').style.display = nodes.length? 'none':'flex';
    if(!nodes.length){ draw(); return; }
    // fit transform so the spread fills the viewport on first paint
    alpha = 1; ensureLoop();
  };

  function step(){
    var REP = 1600, SPRING = 0.02, CENTER = 0.015, DAMP = 0.86;
    for(var i=0;i<nodes.length;i++){
      var a=nodes[i];
      for(var j=i+1;j<nodes.length;j++){
        var b=nodes[j], dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy+0.01, d=Math.sqrt(d2);
        var f=REP/d2; var ux=dx/d, uy=dy/d;
        a.vx+=ux*f; a.vy+=uy*f; b.vx-=ux*f; b.vy-=uy*f;
      }
      a.vx += (W/2 - a.x)*CENTER; a.vy += (H/2 - a.y)*CENTER;
    }
    edges.forEach(function(e){
      var a=byId[e.source], b=byId[e.target];
      var dx=b.x-a.x, dy=b.y-a.y; var w=Math.min(3,(e.weight||1));
      a.vx+=dx*SPRING*w; a.vy+=dy*SPRING*w; b.vx-=dx*SPRING*w; b.vy-=dy*SPRING*w;
    });
    var move=0;
    nodes.forEach(function(n){ n.vx*=DAMP; n.vy*=DAMP; n.x+=n.vx*alpha; n.y+=n.vy*alpha; move+=Math.abs(n.vx)+Math.abs(n.vy); });
    alpha *= 0.97;
    if(alpha<0.02 || move<0.5) alpha=0;
  }

  function draw(){
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.clearRect(0,0,W,H);
    ctx.save(); ctx.translate(tx,ty); ctx.scale(scale,scale);
    // edges
    ctx.lineWidth = 1/scale; ctx.strokeStyle='rgba(148,163,184,0.22)';
    edges.forEach(function(e){ var a=byId[e.source], b=byId[e.target];
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); });
    // nodes
    nodes.forEach(function(n){
      var r=radius(n), col=COLORS[n.state]||COLORS.normal;
      if(n.state==='planned_add'){ ctx.setLineDash([4,3]); ctx.strokeStyle=col; ctx.lineWidth=2/scale; ctx.beginPath(); ctx.arc(n.x,n.y,r+3,0,7); ctx.stroke(); ctx.setLineDash([]); }
      ctx.beginPath(); ctx.arc(n.x,n.y,r,0,7); ctx.fillStyle=col+'33'; ctx.fill();
      ctx.lineWidth=2/scale; ctx.strokeStyle=col; ctx.stroke();
      if(scale>0.45){ ctx.fillStyle='#e4e4e7'; ctx.font=(11)+'px -apple-system,sans-serif'; ctx.textAlign='center';
        var lab=n.label.length>16? n.label.slice(0,15)+'…':n.label;
        ctx.fillText(lab, n.x, n.y+r+12/scale); }
    });
    ctx.restore();
  }

  var raf=null;
  function loop(){ if(alpha>0) step(); draw(); if(alpha>0){ raf=requestAnimationFrame(loop); } else { raf=null; } }
  function ensureLoop(){ if(!raf) raf=requestAnimationFrame(loop); }

  // --- touch: pan / pinch / tap ---
  var dragging=false, moved=false, lastX=0, lastY=0, pinchD=0, downT=0;
  function dist(t){ var dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); }
  canvas.addEventListener('touchstart', function(ev){
    ev.preventDefault();
    if(ev.touches.length===1){ dragging=true; moved=false; lastX=ev.touches[0].clientX; lastY=ev.touches[0].clientY; downT=Date.now(); }
    else if(ev.touches.length===2){ pinchD=dist(ev.touches); dragging=false; }
  }, {passive:false});
  canvas.addEventListener('touchmove', function(ev){
    ev.preventDefault();
    if(ev.touches.length===2){
      var d=dist(ev.touches), f=d/(pinchD||d);
      var cx=(ev.touches[0].clientX+ev.touches[1].clientX)/2, cy=(ev.touches[0].clientY+ev.touches[1].clientY)/2;
      var ns=Math.max(0.25, Math.min(3, scale*f));
      tx = cx - (cx - tx)*(ns/scale); ty = cy - (cy - ty)*(ns/scale); scale=ns; pinchD=d; draw();
    } else if(dragging && ev.touches.length===1){
      var x=ev.touches[0].clientX, y=ev.touches[0].clientY;
      tx += x-lastX; ty += y-lastY; lastX=x; lastY=y;
      if(Math.abs(x-lastX)>2||Math.abs(y-lastY)>2) moved=true; moved=moved||true; draw();
    }
  }, {passive:false});
  canvas.addEventListener('touchend', function(ev){
    if(dragging && !moved && Date.now()-downT<300){
      // tap: hit-test in graph space
      var gx=(lastX-tx)/scale, gy=(lastY-ty)/scale, hit=null;
      for(var i=nodes.length-1;i>=0;i--){ var n=nodes[i], r=radius(n); if((gx-n.x)*(gx-n.x)+(gy-n.y)*(gy-n.y) <= (r+6)*(r+6)){ hit=n; break; } }
      if(hit) send({type:'tap', id:hit.id});
    }
    dragging=false;
  });

  send({type:'ready'});
})();
</script></body></html>`;
