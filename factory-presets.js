/* ============ factory presets ============ */
const LIB={drum:[],bass:[],lead:[],pad:[],pluck:[],arp:[],fx:[]};
function DP(id,name,genre,p){LIB.drum.push(Object.assign({id,name,genre,cat:'drum',engine:'DRUM',type:'kick',tune:1,decay:1,tone:1,punch:0},p))}
function SP(cat,id,name,genre,p){LIB[cat].push(Object.assign({id,name,genre,cat,engine:'SYNTH',
wave1:'sawtooth',wave2:'sawtooth',oct2:0,detune:8,cutoff:1500,res:3,fType:'lowpass',
atk:0.005,dec:0.3,sus:0.6,rel:0.2,gate:0.6,lfoRate:0,lfoDepth:0,lfoDest:'off',poly:6},p))}
DP('TE-KICK-SUB','Techno Sub Kick','TECHNO',{type:'kick',tune:.85,decay:1.6,punch:.1});
DP('TE-KICK-PUNCH','Techno Punch Kick','TECHNO',{type:'kick',tune:1.15,decay:.7,punch:.9});
DP('TE-KICK-HARD','Techno Hard Kick','TECHNO',{type:'kick',tune:1,decay:1.1,punch:.7});
DP('TE-KICK-RUMBLE','Techno Rumble Kick','TECHNO',{type:'kick',tune:.75,decay:2.4,punch:.2});
DP('SNARE-TE','Techno Tight Snare','TECHNO',{type:'snare',tune:1.1,decay:.6,tone:1.3});
DP('HAT-TE','Techno Crisp Hat','TECHNO',{type:'hatC',decay:.5});
DP('HAT-TE-O','Techno Open Hat','TECHNO',{type:'hatO',decay:.9});
DP('PERC-TE','Techno Metal Perc','TECHNO',{type:'rim',tune:1,tone:1.6});
DP('FX-TE-RISE','Techno Riser','TECHNO',{type:'riser'});
DP('PS-KICK-TIGHT','Psy Tight Kick','PSYTRANCE',{type:'kick',tune:.9,decay:.5,punch:.85});
DP('PS-KICK-DEEP','Psy Deep Kick','PSYTRANCE',{type:'kick',tune:.7,decay:1.15,punch:.4});
DP('PS-HAT','Psy Bright Hat','PSYTRANCE',{type:'hatC',decay:.32,tone:1.5});
DP('PS-PERC','Psy Rolling Perc','PSYTRANCE',{type:'tom',tune:1.2,decay:.5});
DP('PS-GLITCH','Psy Glitch','PSYTRANCE',{type:'glitch',tone:.8,decay:1.2});
DP('FX-PS-RISE','Psy Riser','PSYTRANCE',{type:'riser'});
DP('TR-KICK','Trance Punch Kick','TRANCE',{type:'kick',tune:1.05,decay:.85,punch:.85});
DP('TR-CLAP','Trance Clap','TRANCE',{type:'clap',decay:1.6,tone:.9});
DP('TR-HAT-O','Trance Open Hat','TRANCE',{type:'hatO',decay:.6});
DP('TR-PERC','Trance Perc','TRANCE',{type:'tom',tune:.85,decay:.9});
DP('FX-TR-IMPACT','Trance Impact','TRANCE',{type:'impact'});
DP('PR-KICK','Prog Soft Kick','PROGRESSIVE',{type:'kick',tune:.9,decay:1,punch:.25});
DP('PR-PERC','Prog Organic Perc','PROGRESSIVE',{type:'tom',tune:.85,decay:.9,tone:.9});
DP('PR-HAT','Prog Soft Hat','PROGRESSIVE',{type:'hatC',decay:.6,tone:.7});
DP('PR-SHAKER','Prog Shaker','PROGRESSIVE',{type:'shaker',decay:.5});
SP('bass','TE-BASS-RUMBLE','Techno Rumble Bass','TECHNO',{wave1:'sawtooth',wave2:'sawtooth',oct2:-1,detune:14,cutoff:220,res:6,gate:1.6,dec:.5});
SP('bass','TE-BASS-ACID','Techno Acid Bass','TECHNO',{wave1:'sawtooth',wave2:'square',cutoff:500,res:16,gate:.35,dec:.12,sus:.2,poly:2});
SP('bass','TE-BASS-DIST','Techno Dist Bass','TECHNO',{wave1:'sawtooth',wave2:'square',detune:6,cutoff:1400,gate:.5,poly:2});
SP('bass','PS-BASS-ROLL','Psy Rolling Bass','PSYTRANCE',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:4,cutoff:700,res:9,gate:.3,dec:.1,sus:.2,poly:2});
SP('bass','PS-BASS-DEEP','Psy Deep Bass','PSYTRANCE',{wave1:'sawtooth',wave2:'sawtooth',oct2:-1,detune:12,cutoff:450,res:7,gate:.5,poly:2});
SP('bass','PS-BASS-AGGRO','Psy Aggro Bass','PSYTRANCE',{wave1:'sawtooth',wave2:'sawtooth',oct2:-1,detune:18,cutoff:1100,res:6,gate:.4,poly:2});
SP('bass','PS-BASS-FM','Psy FM Bass','PSYTRANCE',{wave1:'sine',wave2:'sine',oct2:1,cutoff:2200,gate:.4,poly:2});
SP('bass','TR-BASS-OFFBEAT','Trance Offbeat Bass','TRANCE',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:5,cutoff:600,res:8,gate:.55,dec:.3,poly:2});
SP('bass','TR-BASS-SAW','Trance Supersaw Bass','TRANCE',{wave1:'sawtooth',wave2:'sawtooth',detune:24,cutoff:1200,gate:.6,poly:3});
SP('bass','PR-BASS-WARM','Prog Warm Bass','PROGRESSIVE',{wave1:'triangle',wave2:'sine',oct2:-1,detune:3,cutoff:500,gate:.7,poly:2});
SP('bass','PR-BASS-PLUCK','Prog Pluck Bass','PROGRESSIVE',{wave1:'sawtooth',wave2:'triangle',cutoff:1000,res:6,gate:.3,dec:.14,sus:.1,poly:3});
SP('lead','TE-LEAD-ACID','Techno Acid Lead','TECHNO',{wave1:'sawtooth',cutoff:700,res:18,gate:.3,dec:.1,sus:.2,poly:2});
SP('lead','PS-LEAD-SQUELCH','Psy Squelch Lead','PSYTRANCE',{wave1:'square',wave2:'sawtooth',detune:8,cutoff:2400,res:12,gate:.45,dec:.18,sus:.4,poly:4});
SP('lead','PS-LEAD-FMTEX','Psy FM Texture','PSYTRANCE',{wave1:'sine',wave2:'sine',oct2:1,detune:2,cutoff:2600,lfoRate:8,lfoDepth:.3,lfoDest:'cutoff',gate:.6,poly:4});
SP('lead','TR-LEAD-SAW','Trance Supersaw Lead','TRANCE',{wave1:'sawtooth',wave2:'sawtooth',detune:22,cutoff:3200,gate:.7,poly:6});
SP('lead','PR-LEAD-MELODIC','Prog Melodic Lead','PROGRESSIVE',{wave1:'sawtooth',wave2:'triangle',detune:8,cutoff:2600,gate:.75,poly:6});
SP('pad','TE-PAD-DARK','Techno Dark Pad','TECHNO',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:16,cutoff:700,atk:.8,rel:1.4,gate:2.6,poly:8});
SP('pad','PS-PAD-PSYCH','Psy Psychedelic Pad','PSYTRANCE',{wave1:'sawtooth',wave2:'sine',oct2:1,detune:14,cutoff:1400,res:6,atk:.7,rel:1.3,lfoRate:.3,lfoDepth:.4,lfoDest:'cutoff',gate:2.6,poly:8});
SP('pad','TR-PAD-ATMO','Trance Atmosphere','TRANCE',{wave1:'sawtooth',wave2:'sawtooth',detune:18,cutoff:1800,atk:1,rel:1.8,lfoRate:.2,lfoDepth:.3,lfoDest:'cutoff',gate:3,poly:8});
SP('pad','PR-PAD-EVOLVE','Prog Evolving Pad','PROGRESSIVE',{wave1:'sawtooth',wave2:'triangle',detune:10,cutoff:900,atk:1.2,rel:1.6,lfoRate:.12,lfoDepth:.5,lfoDest:'cutoff',gate:3,poly:8});
SP('pluck','TE-PLUCK-STAB','Techno Stab','TECHNO',{wave1:'square',wave2:'triangle',cutoff:1500,res:8,gate:.15,dec:.08,sus:.05,poly:4});
SP('pluck','TR-PLUCK-GATE','Trance Gate Pluck','TRANCE',{wave1:'sawtooth',wave2:'sawtooth',detune:10,cutoff:2200,res:6,gate:.28,dec:.14,sus:.1,poly:6});
SP('pluck','PR-PLUCK-ORG','Prog Organic Pluck','PROGRESSIVE',{wave1:'triangle',wave2:'sawtooth',detune:5,cutoff:1800,gate:.35,dec:.18,sus:.15,poly:6});
SP('arp','TE-ARP-HYPNO','Techno Hypnotic Arp','TECHNO',{wave1:'sawtooth',wave2:'triangle',oct2:-1,detune:8,cutoff:1000,res:6,gate:.3,dec:.15,sus:.3,poly:4});
SP('arp','PS-ARP-ACID','Psy Acid Arp','PSYTRANCE',{wave1:'square',wave2:'sawtooth',detune:6,cutoff:1800,res:11,gate:.24,dec:.1,sus:.2,poly:4});
SP('arp','TR-ARP-ROLL','Trance Rolling Arp','TRANCE',{wave1:'sawtooth',wave2:'sawtooth',detune:12,cutoff:2600,gate:.28,dec:.12,sus:.2,poly:6});
SP('arp','PR-ARP-MELODIC','Prog Melodic Arp','PROGRESSIVE',{wave1:'triangle',wave2:'sawtooth',detune:7,cutoff:2200,gate:.4,dec:.2,sus:.4,poly:6});
SP('fx','FX-SWEEP','Noise Sweep FX','ANY',{wave1:'sawtooth',wave2:'sawtooth',oct2:1,detune:24,cutoff:500,res:10,atk:.9,rel:.6,gate:2.5,lfoRate:.4,lfoDepth:.6,lfoDest:'cutoff',poly:2});
function libFind(id){for(const cat in LIB){const f=LIB[cat].find(x=>x.id===id);if(f)return f}return null}
function libCount(){let n=0;for(const c in LIB)n+=LIB[c].length;return n}
function libFilter(cat,genre){const out=[];for(const c in LIB){if(cat!=='all'&&c!==cat)continue;
for(const x of LIB[c])if(genre==='ALL'||x.genre===genre||x.genre==='ANY')out.push(x)}return out}
function assignPresetToTrack(p,t,pr){
const tr=p.tracks[t];
if(pr.cat==='drum'){tr.kind='drum';tr.sound=Object.assign({},pr);tr.type=pr.type}
else{tr.kind='synth';tr.sound=Object.assign({},pr);tr.type=null}
tr.presetId=pr.id;tr.name=pr.name;
}
function initTracks(p){
p.tracks=[];const names=['KICK','SNARE','HATS','PERC','BASS','LEAD','PAD','ARP'];
for(let t=0;t<MAX_TRACKS;t++)p.tracks.push({idx:t,kind:t<4?'drum':'synth',name:names[t],
sound:{},presetId:'',mix:{vol:.8,pan:0,mute:false,solo:false,sendA:0,sendB:0}});
}
function buildStyle(style,seed){
const rng=mulberry32(seed||1);
const p=mkProject();initTracks(p);
const A=mkPattern('A',8),B=mkPattern('B',8);
p.patterns={};p.patterns['A']=A;p.patterns['B']=B;
p.scenes=Array.from({length:MAX_SCENES},(_,i)=>({name:i<2?('SCENE '+(i+1)):'-',pattern:i===0?'A':(i===1?'B':null)}));
p.currentPattern='A';p.activeScene=0;
const put=(pat,t,i,vel,note)=>{const d=pat.data[t],L=d.len,s=d.steps[((i%L)+L)%L];s.on=1;if(vel)s.vel=vel;if(note!=null)s.note=note};
const setLen=(pat,t,l)=>{const d=pat.data[t];const old=d.steps;d.len=l;d.steps=Array.from({length:l},(_,k)=>old[k%old.length]||mkStep(false))};
const root=p.root;
if(style==='TECHNO'){
p.bpm=128;p.scale='minor';
assignPresetToTrack(p,0,libFind('TE-KICK-PUNCH'));assignPresetToTrack(p,1,libFind('SNARE-TE'));
assignPresetToTrack(p,2,libFind('HAT-TE'));assignPresetToTrack(p,3,libFind('PERC-TE'));
assignPresetToTrack(p,4,libFind('TE-BASS-RUMBLE'));assignPresetToTrack(p,5,libFind('TE-LEAD-ACID'));
assignPresetToTrack(p,6,libFind('TE-PAD-DARK'));assignPresetToTrack(p,7,libFind('TE-ARP-HYPNO'));
for(const pat of[A,B]){
for(let i=0;i<16;i+=4)put(pat,0,i,.95);
if(rng()>.5)put(pat,0,14,.55);
put(pat,1,4,.8);put(pat,1,12,.8);
for(let i=2;i<16;i+=4)put(pat,2,i,.5+rng()*.2);
put(pat,3,7,.5);put(pat,3,11,.4);
for(let i=2;i<16;i+=4)put(pat,4,i,.85,root);
put(pat,5,0,.5,root+24);pat.data[5].steps[0].lock={cutoff:900};
put(pat,6,0,.45,root+12);
setLen(pat,7,32);
for(let i=0;i<32;i+=2)if(rng()>.35){const s=pat.data[7].steps[i];s.on=1;s.note=root+24+SCALES.minor[Math.floor(rng()*5)];s.vel=.3+rng()*.25;s.prob=.85}
}
for(let i=0;i<16;i+=2)put(B,2,i,(i%4===2)?.75:.45);
put(B,5,3,.6,root+27);put(B,5,10,.55,root+24);B.data[5].steps[10].lock={cutoff:3200};
}else if(style==='PSYTRANCE'){
p.bpm=145;p.scale='phrygian';
assignPresetToTrack(p,0,libFind('PS-KICK-TIGHT'));assignPresetToTrack(p,1,libFind('PS-KICK-DEEP'));
assignPresetToTrack(p,2,libFind('PS-HAT'));assignPresetToTrack(p,3,libFind('PS-PERC'));
assignPresetToTrack(p,4,libFind('PS-BASS-ROLL'));assignPresetToTrack(p,5,libFind('PS-LEAD-SQUELCH'));
assignPresetToTrack(p,6,libFind('PS-PAD-PSYCH'));assignPresetToTrack(p,7,libFind('PS-ARP-ACID'));
const sc=SCALES.phrygian;
for(const pat of[A,B]){
for(let i=0;i<16;i+=4)put(pat,0,i,.95);
for(let i=1;i<16;i+=2)put(pat,4,i,.9,root);
for(let i=2;i<16;i+=4){put(pat,2,i,.6);if(i+1<16)put(pat,2,i+1,.28)}
put(pat,3,6,.45);put(pat,3,14,.35);
put(pat,5,0,.6,root+22);pat.data[5].steps[0].lock={cutoff:500,res:16};
put(pat,5,8,.6,root+24);pat.data[5].steps[8].lock={cutoff:4200,res:12};
put(pat,6,0,.4,root+12);
for(let i=0;i<16;i+=2)if(rng()>.4){const s=pat.data[7].steps[i];s.on=1;s.note=root+36+sc[Math.floor(rng()*sc.length)];s.vel=.32;s.prob=.8}
}
for(let i=1;i<16;i+=2)put(B,4,i,.9,root+((i%8===7)?3:0));
}else if(style==='TRANCE'){
p.bpm=138;p.scale='minor';
assignPresetToTrack(p,0,libFind('TR-KICK'));assignPresetToTrack(p,1,libFind('TR-CLAP'));
assignPresetToTrack(p,2,libFind('TR-HAT-O'));assignPresetToTrack(p,3,libFind('TR-PERC'));
assignPresetToTrack(p,4,libFind('TR-BASS-OFFBEAT'));assignPresetToTrack(p,5,libFind('TR-LEAD-SAW'));
assignPresetToTrack(p,6,libFind('TR-PAD-ATMO'));assignPresetToTrack(p,7,libFind('TR-ARP-ROLL'));
for(const pat of[A,B]){
for(let i=0;i<16;i+=4)put(pat,0,i,.95);
put(pat,1,4,.8);put(pat,1,12,.8);
for(let i=2;i<16;i+=4)put(pat,2,i,.58);
for(let i=2;i<16;i+=4)put(pat,4,i,.85,root);
put(pat,6,0,.5,root+12);
for(let i=0;i<16;i+=2){const s=pat.data[7].steps[i];s.on=1;s.note=root+24+SCALES.minor[(i/2)%7];s.vel=.35}
put(pat,5,6,.55,root+24);
}
put(B,6,0,.5,root+15);B.data[6].steps[0].lock={cutoff:2600};put(B,6,8,.45,root+12);
}else if(style==='PROGRESSIVE'){
p.bpm=122;p.scale='dorian';
assignPresetToTrack(p,0,libFind('PR-KICK'));assignPresetToTrack(p,1,libFind('PR-PERC'));
assignPresetToTrack(p,2,libFind('PR-HAT'));assignPresetToTrack(p,3,libFind('PR-SHAKER'));
assignPresetToTrack(p,4,libFind('PR-BASS-WARM'));assignPresetToTrack(p,5,libFind('PR-LEAD-MELODIC'));
assignPresetToTrack(p,6,libFind('PR-PAD-EVOLVE'));assignPresetToTrack(p,7,libFind('PR-ARP-MELODIC'));
const sc=SCALES.dorian;
for(const pat of[A,B]){
for(let i=0;i<16;i+=4)put(pat,0,i,.85);
put(pat,1,6,.4);put(pat,1,13,.35);
for(let i=0;i<16;i+=2)put(pat,3,i,.3+((i*7)%5)/20);
for(let i=2;i<16;i+=2)put(pat,2,i,.5);
put(pat,4,0,.8,root);put(pat,4,3,.7,root);put(pat,4,8,.8,root);put(pat,4,11,.65,root+2);
put(pat,6,0,.5,root+12);
for(let i=0;i<16;i+=4)put(pat,7,i,.35,root+24+sc[(i/4)%7]);
put(pat,5,4,.5,root+24);put(pat,5,12,.45,root+27);
}
put(B,6,0,.5,root+14);put(B,5,4,.5,root+26);put(B,5,12,.45,root+24);
}else{
assignPresetToTrack(p,0,libFind('TE-KICK-PUNCH'));assignPresetToTrack(p,1,libFind('SNARE-TE'));
assignPresetToTrack(p,2,libFind('HAT-TE'));assignPresetToTrack(p,3,libFind('PERC-TE'));
assignPresetToTrack(p,4,libFind('PS-BASS-ROLL'));assignPresetToTrack(p,5,libFind('PS-LEAD-SQUELCH'));
assignPresetToTrack(p,6,libFind('TE-PAD-DARK'));assignPresetToTrack(p,7,libFind('TE-ARP-HYPNO'));
}
p.tracks.forEach(t=>t.base=deep({sound:t.sound,mix:{sendA:t.mix.sendA,sendB:t.mix.sendB,vol:t.mix.vol}}));
p.style=style;return p;
}
