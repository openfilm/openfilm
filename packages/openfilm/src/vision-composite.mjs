import { BEAUTY_KEYS } from './vision-config.mjs';
const vertex = `attribute vec2 point; varying vec2 uv; void main(){ gl_Position=vec4(point,0.,1.); uv=vec2((point.x+1.)*.5,(1.-point.y)*.5); }`;
const fragment = `precision highp float;
varying vec2 uv;
uniform sampler2D source,person,skin,features,makeup;
uniform vec2 pixel,maskPixel;
uniform vec4 anchors[24];
uniform vec4 glasses;
uniform float texture,protectGlasses;
uniform float faceCount,cutout,mode,edge,shrink,despill,keyTolerance,keySoftness;
uniform vec3 keyColor,lipPigment,blushPigment,shadowPigment;
uniform float ${BEAUTY_KEYS.join(',')};
float luminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
float region(vec2 p,vec2 c,vec2 r){return pow(max(0.,1.-dot((p-c)/max(r,vec2(.00001)),(p-c)/max(r,vec2(.00001)))),2.);}
vec2 bulge(vec2 p,vec2 c,vec2 r,float amount){return p-(p-c)*region(p,c,r)*amount;}
vec2 localPoint(vec2 p,vec2 center,vec2 axis,vec2 vertical,vec2 aspect){
  vec2 d=p*aspect-center;return vec2(dot(d,axis),dot(d,vertical));
}
vec2 warp(vec2 p){
  vec2 aspect=vec2(pixel.y/pixel.x,1.);
  for(int i=0;i<4;i++){
    if(float(i)>=faceCount)break;
    vec4 box=anchors[i*6],eyesAt=anchors[i*6+1],noseAt=anchors[i*6+2],ends=anchors[i*6+5];
    vec2 center=box.xy*aspect,size=box.zw*aspect;
    vec2 axis=normalize((eyesAt.zw-eyesAt.xy)*aspect+vec2(.000001,0.));
    if(axis.x<0.)axis=-axis;
    vec2 vertical=vec2(-axis.y,axis.x);
    vec2 q=localPoint(p,center,axis,vertical,aspect);
    vec2 le=localPoint(eyesAt.xy,center,axis,vertical,aspect),re=localPoint(eyesAt.zw,center,axis,vertical,aspect);
    vec2 np=localPoint(noseAt.xy,center,axis,vertical,aspect),chinAt=localPoint(ends.xy,center,axis,vertical,aspect);
    float face=region(q,vec2(0.),size*vec2(.63,.65));
    // Suppress frontal reshape on strongly turned faces; protect spectacles from eye/nose warps.
    float pose=clamp(1.-abs(np.x-(le.x+re.x)*.5)/max(.0001,abs(re.x-le.x))*.85,.25,1.);
    float eyeGuard=1.-protectGlasses*glasses[i]*.85;
    q.x+=q.x*slim*.18*face*pose;
    float lower=region(q,vec2(0.,chinAt.y*.55),size*vec2(.6,.4));
    q.x+=q.x*jaw*.17*lower*pose;
    q.y-=chin*size.y*.045*region(q,chinAt,size*vec2(.42,.24));
    q=bulge(q,le,size*vec2(.20,.14),eyes*.24*eyeGuard);
    q=bulge(q,re,size*vec2(.20,.14),eyes*.24*eyeGuard);
    q.x+=(q.x-np.x)*nose*.22*region(q,np,size*vec2(.20,.22))*eyeGuard*pose;
    p=(center+axis*q.x+vertical*q.y)/aspect;
  }
  return clamp(p,vec2(0.),vec2(1.));
}
vec3 chroma(vec3 c){return vec3(luminance(c),c.b-luminance(c),c.r-luminance(c));}
float rawAlpha(vec2 p){
  if(mode>2.5&&mode<3.5){vec3 a=chroma(texture2D(source,p).rgb),b=chroma(keyColor);float d=length(a.yz-b.yz);return smoothstep(keyTolerance*.9,keyTolerance*.9+.005+keySoftness*.45,d);}
  float a=texture2D(person,p).r;
  return a;
}
void main(){
  vec2 p=warp(uv);vec4 original=texture2D(source,p);
  vec3 sum=vec3(0.);float weight=0.;vec2 stepSize=pixel*(2.+smooth*5.);
  if(smooth>0.||detail>0.||blemish>0.){
  for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++){
    vec3 c=texture2D(source,p+vec2(float(x),float(y))*stepSize).rgb;
    vec3 diff=c-original.rgb;float w=exp(-dot(diff,diff)*48.-float(x*x+y*y)*.28);
    sum+=c*w;weight+=w;
  }
  }else{sum=original.rgb;weight=1.;}
  vec3 blurred=sum/max(weight,.00001);
  float face=texture2D(skin,p).r;
  // Reject highly saturated cosmetics and very dark hair inside the face oval.
  float spread=max(original.r,max(original.g,original.b))-min(original.r,min(original.g,original.b));
  float skinWeight=face*smoothstep(.06,.20,luminance(original.rgb))*(1.-smoothstep(.5,.85,spread));
  vec4 feat=texture2D(features,p),paint=texture2D(makeup,p);
  // Frequency separation: smooth broad unevenness while retaining fine pores and protected feature edges.
  vec3 fine=(texture2D(source,p+vec2(pixel.x,0.)).rgb+texture2D(source,p-vec2(pixel.x,0.)).rgb+
    texture2D(source,p+vec2(0.,pixel.y)).rgb+texture2D(source,p-vec2(0.,pixel.y)).rgb)*.25;
  vec3 micro=original.rgb-fine;
  float blemishGate=smoothstep(.018,.09,luminance(blurred)-luminance(original.rgb));
  vec3 retouched=mix(original.rgb,blurred,clamp(smooth*.8+blemish*blemishGate*.85,0.,.95));
  retouched+=micro*texture*smooth*.65*(1.-blemishGate*blemish);
  vec3 color=mix(original.rgb,retouched,skinWeight);
  color+=skinWeight*detail*(original.rgb-blurred)*.7;
  float l=luminance(color);
  vec3 evenColor=mix(color,vec3(l),.12)+vec3(.012,.002,-.008);
  color=mix(color,evenColor,skinWeight*even);
  color=mix(color,1.-(1.-color)*(1.-light*.23),skinWeight);
  // Reduce highlight intensity without inventing detail in clipped source pixels.
  float highlightGate=smoothstep(.68,.98,luminance(color));
  color*=1.-skinWeight*highlights*highlightGate*.22;
  color+=skinWeight*(warm*vec3(.055,.009,-.025)+rosy*vec3(.035,-.006,.009));
  color+=feat.a*darkCircles*(1.-color)*.13*skinWeight;
  float whiteGate=smoothstep(.28,.65,luminance(original.rgb))*(1.-smoothstep(.14,.35,spread));
  color=mix(color,vec3(luminance(color)),feat.b*teeth*whiteGate*.65);
  color+=feat.b*teeth*whiteGate*(1.-color)*.32;
  color+=feat.g*eyeBright*(1.-color)*whiteGate*.17;
  // Luminance-preserving pigments retain skin texture and lighting.
  vec3 lipColor=lipPigment*(luminance(color)/max(.05,luminance(lipPigment)));
  color=mix(color,lipColor,feat.r*lip*.48);
  vec3 blushColor=blushPigment*(luminance(color)/max(.05,luminance(blushPigment)));
  color=mix(color,blushColor,paint.r*blush*.24*skinWeight);
  color=mix(color,color*mix(vec3(1.),shadowPigment,.55),paint.g*shadow*.38*(1.-feat.g));
  float alpha=original.a;
  if(cutout>.5){
    float a=rawAlpha(p),sumA=a,total=1.,lo=a,hi=a;
    vec3 back=vec3(0.);float backWeight=0.;
    for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
      vec2 offset=vec2(float(x),float(y));
      vec2 q=p+offset*maskPixel*(.25+edge*1.75);
      vec3 c=texture2D(source,q).rgb;vec3 d=c-original.rgb;float b=rawAlpha(q);
      float w=exp(-dot(d,d)*55.-float(x*x+y*y)*.35);
      sumA+=b*w;total+=w;lo=min(lo,b);hi=max(hi,b);
      vec2 outside=p+offset*max(maskPixel*3.,pixel*6.);
      float ba=rawAlpha(outside),bw=pow(1.-ba,6.);
      back+=texture2D(source,outside).rgb*bw;backWeight+=bw;
    }
    a=mix(a,sumA/total,edge);
    a=mix(a,shrink>0.?lo:hi,abs(shrink));
    if(mode<.5)a=smoothstep(.25,.75,a);
    if(backWeight>.1&&a>.015&&a<.985){
      vec3 foreground=clamp((color-(1.-a)*back/backWeight)/max(a,.15),0.,1.);
      color=mix(color,foreground,despill*(1.-smoothstep(.7,1.,a)));
    }
    if(mode>2.5&&mode<3.5){float green=max(0.,color.g-max(color.r,color.b));float keyGreen=max(0.,keyColor.g-max(keyColor.r,keyColor.b));color.g-=green*despill*step(.1,keyGreen);}
    alpha*=a;
  }
  gl_FragColor=vec4(clamp(color,0.,1.),alpha);
}`;
export class VisionComposite {
  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const gl = (this.gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }));
    if (!gl) throw new Error('WebGL is required for video effects. Enable graphics acceleration and retry.');
    const shader = (kind, source) => {
      const s = gl.createShader(kind);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = (this.program = gl.createProgram()),
      vs = shader(gl.VERTEX_SHADER, vertex),
      fs = shader(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program, 'point');
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    this.uploadedMasks = [];
    this.textures = ['source', 'person', 'skin', 'features', 'makeup'].map((name, i) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, name), i);
      return t;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }
  render(frame, analysis, settings, maxSide = Infinity) {
    const gl = this.gl;
    if (gl.isContextLost()) throw new Error('The graphics context was lost. Disable video effects and retry.');
    const scale = Math.min(1, maxSide / Math.max(frame.width, frame.height)),
      w = Math.max(1, Math.round(frame.width * scale)),
      h = Math.max(1, Math.round(frame.height * scale));
    if (w > gl.getParameter(gl.MAX_TEXTURE_SIZE) || h > gl.getParameter(gl.MAX_TEXTURE_SIZE))
      throw new Error('This video exceeds the graphics device texture limit.');
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
    if (this.sourceSize === `${frame.width}x${frame.height}`) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame); this.sourceSize = `${frame.width}x${frame.height}`; }
    [analysis.person, analysis.skin, analysis.features, analysis.makeup].forEach((mask, i) => {
      mask ??= { w: 1, h: 1, data: new Uint8Array([0]) };
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i + 1]);
      const previous = this.uploadedMasks[i];
      if (previous?.mask === mask) return;
      const format = mask.rgba ? gl.RGBA : gl.LUMINANCE;
      if (previous?.w === mask.w && previous?.h === mask.h && previous?.format === format)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mask.w, mask.h, format, gl.UNSIGNED_BYTE, mask.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, format, mask.w, mask.h, 0, format, gl.UNSIGNED_BYTE, mask.data);
      this.uploadedMasks[i] = { mask, w: mask.w, h: mask.h, format };
    });
    for (const key of [...BEAUTY_KEYS, 'cutout', 'mode', 'edge', 'shrink', 'despill', 'keyTolerance', 'keySoftness', 'texture', 'protectGlasses'])
      gl.uniform1f(gl.getUniformLocation(this.program, key), Number(settings[key] ?? 0));
    gl.uniform4fv(gl.getUniformLocation(this.program, 'glasses'), analysis.glasses ?? new Float32Array(4));
    gl.uniform1f(gl.getUniformLocation(this.program, 'faceCount'), analysis.faceCount ?? 0);
    gl.uniform4fv(gl.getUniformLocation(this.program, 'anchors[0]'), analysis.anchors ?? new Float32Array(96));
    const hex = settings.keyColor ?? '#00ff00';
    gl.uniform3f(
      gl.getUniformLocation(this.program, 'keyColor'),
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    );
    gl.uniform2f(gl.getUniformLocation(this.program, 'pixel'), 1 / frame.width, 1 / frame.height);
    gl.uniform2f(
      gl.getUniformLocation(this.program, 'maskPixel'),
      1 / (analysis.person?.w ?? frame.width),
      1 / (analysis.person?.h ?? frame.height),
    );
    for (const [key, uniform] of [
      ['lipColor', 'lipPigment'],
      ['blushColor', 'blushPigment'],
      ['shadowColor', 'shadowPigment'],
    ]) {
      const c = settings[key] ?? '#000000';
      gl.uniform3f(
        gl.getUniformLocation(this.program, uniform),
        parseInt(c.slice(1, 3), 16) / 255,
        parseInt(c.slice(3, 5), 16) / 255,
        parseInt(c.slice(5, 7), 16) / 255,
      );
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas.transferToImageBitmap();
  }
}
