import React from 'react';
import type { WorkspaceLayout } from '@/lib/workspaces';
import { workspacePreviewFrames } from '@/lib/workspace-preview';
import type { DockPanel, DockRect } from '@/lib/workspace-dock';

function Content({panel,rect:r}:{panel:DockPanel;rect:DockRect}) {
  const p=Math.min(18,r.width*.08,r.height*.08),w=Math.max(0,r.width-2*p),h=Math.max(0,r.height-2*p);
  const header=Math.min(24,h*.12),ink='var(--text-faint)';
  const line=(x:number,y:number,width:number,height=8)=><rect x={x} y={y} width={Math.max(0,width)} height={height} rx={height/3} fill={ink} opacity=".45"/>;
  return <g transform={`translate(${r.left+p},${r.top+p})`}>
    {line(0,0,w*.3,header*.5)}
    {panel==='chat'?<>
      {[.18,.28,.42,.52].map((y,i)=><React.Fragment key={y}>{line(i%2?w*.2:0,h*y,w*(i%2?.8:.72),Math.min(11,h*.035))}</React.Fragment>)}
      <rect x="0" y={h*.86} width={w} height={h*.14} rx={Math.min(10,h*.03)} fill="var(--bg-field)" stroke={ink} strokeOpacity=".4"/>
    </>:panel==='timeline'?<>
      <path d={`M0 ${h*.2}H${w}`} stroke={ink} strokeOpacity=".5"/>
      {[.4,.65].map((y,i)=><g key={y}><rect x={w*.12} y={h*y} width={w*(i?.62:.8)} height={h*.15} rx="3" fill={i?'var(--accent)':'#9676b3'} opacity=".65"/><path d={`M${w*.42} ${h*y}v${h*.15}M${w*.7} ${h*y}v${h*.15}`} stroke="var(--bg-panel)" strokeWidth="3"/></g>)}
    </>:panel==='library'?<>
      <path d={`M0 ${h*.17}H${w}`} stroke={ink} strokeOpacity=".35"/>
      {[0,1,2].map(i=>[0,1].map(j=><rect key={`${i}-${j}`} x={w*.23+i*w*.255} y={h*.25+j*h*.33} width={w*.21} height={h*.25} rx="3" fill="var(--accent)" opacity={.3+i*.12}/>))}
      {line(0,h*.3,w*.16)}{line(0,h*.46,w*.16)}
    </>:panel==='canvas'?<>
      <path d={`M${w*.25} ${h*.37}H${w*.55}V${h*.6}H${w*.72}`} stroke={ink} fill="none" strokeWidth="4"/>
      <rect x={w*.12} y={h*.24} width={w*.27} height={h*.28} rx="5" fill="var(--bg-field)" stroke={ink} strokeOpacity=".5"/>
      <rect x={w*.61} y={h*.49} width={w*.27} height={h*.28} rx="5" fill="var(--bg-field)" stroke={ink} strokeOpacity=".5"/>
    </>:panel==='viewer'?<>
      <rect x={w*.13} y={h*.2} width={w*.74} height={h*.56} rx="4" fill="var(--bg-app)"/>
      <path d={`M${w*.47} ${h*.4}l${w*.09} ${h*.08}l-${w*.09} ${h*.08}z`} fill={ink} opacity=".55"/>
      {line(w*.1,h*.92,w*.8,4)}
    </>:<>{[.22,.39,.56,.73].map(y=><React.Fragment key={y}>{line(0,h*y,w*.35)}<rect x={w*.48} y={h*y-4} width={w*.52} height={Math.min(24,h*.07)} rx="3" fill="var(--bg-field)"/></React.Fragment>)}</>}
  </g>;
}

export function WorkspacePreview({layout,viewport,hasChat,timelineFitHeight,inspectorIdle,className}:{layout:WorkspaceLayout;viewport:{width:number;height:number};hasChat:boolean;timelineFitHeight:number;inspectorIdle:boolean;className?:string}) {
  const panels=workspacePreviewFrames(layout,viewport,{hasChat,timelineFitHeight,inspectorIdle});
  const id=React.useId().replace(/:/g,'');
  return <svg data-workspace-preview viewBox={`0 0 ${viewport.width} ${viewport.height}`} className={className} aria-hidden>
    <rect width={viewport.width} height={viewport.height} fill="var(--dock-line)" rx="20"/>
    {(Object.entries(panels) as [DockPanel,DockRect][]).map(([panel,r])=><React.Fragment key={panel}>
      <defs><clipPath id={`${id}-${panel}`}><rect x={r.left+2} y={r.top+2} width={Math.max(0,r.width-4)} height={Math.max(0,r.height-4)}/></clipPath></defs>
      <rect data-preview-panel={panel} x={r.left} y={r.top} width={r.width} height={r.height} fill={panel==='viewer'?'var(--bg-viewer)':'var(--bg-panel)'} stroke="var(--text-faint)" strokeOpacity=".35" strokeWidth="3"/>
      <g clipPath={`url(#${id}-${panel})`}><Content panel={panel} rect={r}/></g>
    </React.Fragment>)}
  </svg>;
}
