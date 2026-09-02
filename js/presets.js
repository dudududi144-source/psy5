import { mulberry32, SCALES, mkProject, mkPattern, mkStep, deep, LIMITS } from './model.js';
import { DEFAULTS } from './limits.js';


/* ============ factory presets ============ */
const LIB={drum:[],bass:[],lead:[],pad:[],pluck:[],arp:[],fx:[],synth:[]};
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
SP('synth','INIT-SYNTH','Init Synth','ANY',{wave1:'sawtooth',wave2:'triangle',cutoff:3200,gate:.5,dec:.3,sus:.5,poly:4});

/* ── v0.12.0 P2: SOUND ENGINE v2 LIBRARY EXPANSION ──
   8 genres (PSYTRANCE, DARK-PSY, GOA, FULL-ON, TECHNO, TRANCE, PROGRESSIVE,
   HI-TECH) + kit assignments (KITS). All presets ride the v2 parameter
   surface (type/tune/decay/tone/punch) — new types (conga, bongo, cowbell,
   clave, zap, boom) enter through the SAME preset → track → trigger path.
   Metadata contract: id unique, name, genre, cat, engine, type (drums),
   numeric params in sane ranges (G40 validates every entry). */
/* PSYTRANCE drums (v0.12.0 additions) */
DP('PS-KICK2-GATE','Psy Gate Kick','PSYTRANCE',{type:'kick',tune:1,decay:.45,punch:.95});
DP('PS-KICK2-ROLL','Psy Rolling Kick','PSYTRANCE',{type:'kick',tune:.95,decay:.62,punch:.75});
DP('PS-KICK2-CRUSH','Psy Crush Kick','PSYTRANCE',{type:'kick',tune:.8,decay:.9,punch:.6});
DP('PS-SNARE2-CRACK','Psy Crack Snare','PSYTRANCE',{type:'snare',tune:1.15,decay:.7,tone:1.35,punch:.6});
DP('PS-SNARE2-FAT','Psy Fat Snare','PSYTRANCE',{type:'snare',tune:.9,decay:1,tone:.9,punch:.3});
DP('PS-CLAP2-ROLL','Psy Roll Clap','PSYTRANCE',{type:'clap',decay:.9,tone:1.15});
DP('PS-HAT2-TICK','Psy Tick Hat','PSYTRANCE',{type:'hatC',decay:.28,tone:1.6});
DP('PS-HAT2-DARK','Psy Dark Hat','PSYTRANCE',{type:'hatC',decay:.42,tone:.8});
DP('PS-HAT2-WIDE','Psy Wide Open Hat','PSYTRANCE',{type:'hatO',decay:.7,tone:1.2});
DP('PS-CONGA-LOW','Psy Low Conga','PSYTRANCE',{type:'conga',tune:.85,decay:.9});
DP('PS-BONGO-HI','Psy Hi Bongo','PSYTRANCE',{type:'bongo',tune:1.1,decay:.7});
DP('PS-RIM2-METAL','Psy Metal Rim','PSYTRANCE',{type:'rim',tune:1.15,tone:1.4});
DP('PS-SHK2-LITE','Psy Light Shaker','PSYTRANCE',{type:'shaker',decay:.5,tone:1.1});
DP('PS-ZAP2-LASER','Psy Laser Zap','PSYTRANCE',{type:'zap',tune:1,decay:.8});
DP('PS-BOOM2-DEEP','Psy Deep Boom','PSYTRANCE',{type:'boom',tune:.9,decay:1.1});
/* DARK-PSY drums */
DP('DR-KICK-HAMMER','Dark Hammer Kick','DARK-PSY',{type:'kick',tune:1.05,decay:.42,punch:1});
DP('DR-KICK-VOID','Dark Void Kick','DARK-PSY',{type:'kick',tune:.65,decay:1.5,punch:.35});
DP('DR-KICK-SPIKE','Dark Spike Kick','DARK-PSY',{type:'kick',tune:.95,decay:.55,punch:.9});
DP('DR-SNARE-WHIP','Dark Whip Snare','DARK-PSY',{type:'snare',tune:1.25,decay:.5,tone:1.5,punch:.8});
DP('DR-CLAP-SCRAP','Dark Scrap Clap','DARK-PSY',{type:'clap',decay:.6,tone:1.4});
DP('DR-HAT-NEEDLE','Dark Needle Hat','DARK-PSY',{type:'hatC',decay:.24,tone:1.7});
DP('DR-HAT-ASH','Dark Ash Hat','DARK-PSY',{type:'hatC',decay:.5,tone:.75});
DP('DR-HAT-VOID-O','Dark Void Open Hat','DARK-PSY',{type:'hatO',decay:.95,tone:1.1});
DP('DR-CONGA-GRAVE','Dark Grave Conga','DARK-PSY',{type:'conga',tune:.7,decay:1.1});
DP('DR-BONGO-FRENZY','Dark Frenzy Bongo','DARK-PSY',{type:'bongo',tune:1.25,decay:.6});
DP('DR-RIM-BLADE','Dark Blade Rim','DARK-PSY',{type:'rim',tune:1.3,tone:1.6});
DP('DR-GLITCH-BIT','Dark Bit Glitch','DARK-PSY',{type:'glitch',tone:1.3,decay:.9});
DP('DR-ZAP-SCREAM','Dark Scream Zap','DARK-PSY',{type:'zap',tune:1.25,decay:.9});
DP('DR-BOOM-ABYSS','Dark Abyss Boom','DARK-PSY',{type:'boom',tune:.75,decay:1.4});
/* GOA drums */
DP('GO-KICK-GLOW','Goa Glow Kick','GOA',{type:'kick',tune:.9,decay:.7,punch:.8});
DP('GO-KICK-SPIRAL','Goa Spiral Kick','GOA',{type:'kick',tune:1,decay:.58,punch:.85});
DP('GO-SNARE-RING','Goa Ring Snare','GOA',{type:'snare',tune:1.2,decay:.75,tone:1.25,punch:.4});
DP('GO-CLAP-TEMPLE','Goa Temple Clap','GOA',{type:'clap',decay:1.2,tone:.95});
DP('GO-HAT-SILVER','Goa Silver Hat','GOA',{type:'hatC',decay:.34,tone:1.45});
DP('GO-HAT-MIST','Goa Mist Open Hat','GOA',{type:'hatO',decay:.85,tone:.9});
DP('GO-CONGA-RITUAL','Goa Ritual Conga','GOA',{type:'conga',tune:1,decay:1});
DP('GO-BONGO-TALK','Goa Talking Bongo','GOA',{type:'bongo',tune:.95,decay:.85});
DP('GO-TOM-MELODY','Goa Melody Tom','GOA',{type:'tom',tune:1.3,decay:.6});
DP('GO-RIM-CHANT','Goa Chant Rim','GOA',{type:'rim',tune:.95,tone:1.2});
DP('GO-SHK-SAND','Goa Sand Shaker','GOA',{type:'shaker',decay:.65,tone:.95});
DP('GO-ZAP-PRISM','Goa Prism Zap','GOA',{type:'zap',tune:.9,decay:.7});
DP('GO-IMPACT-DAWN','Goa Dawn Impact','GOA',{type:'impact',tune:1.1,decay:.9});
DP('GO-RISE-TWILIGHT','Goa Twilight Riser','GOA',{type:'riser'});
/* FULL-ON drums */
DP('FO-KICK-DRIVE','Full-On Drive Kick','FULL-ON',{type:'kick',tune:.95,decay:.55,punch:.9});
DP('FO-KICK-PUMP','Full-On Pump Kick','FULL-ON',{type:'kick',tune:.85,decay:.75,punch:.7});
DP('FO-SNARE-SNAP','Full-On Snap Snare','FULL-ON',{type:'snare',tune:1.1,decay:.6,tone:1.3,punch:.7});
DP('FO-CLAP-BRIGHT','Full-On Bright Clap','FULL-ON',{type:'clap',decay:.8,tone:1.2});
DP('FO-HAT-SPARK','Full-On Spark Hat','FULL-ON',{type:'hatC',decay:.3,tone:1.55});
DP('FO-HAT-FLOW','Full-On Flow Open Hat','FULL-ON',{type:'hatO',decay:.65,tone:1.15});
DP('FO-CONGA-PUSH','Full-On Push Conga','FULL-ON',{type:'conga',tune:1.1,decay:.7});
DP('FO-BONGO-POP','Full-On Pop Bongo','FULL-ON',{type:'bongo',tune:1.2,decay:.55});
DP('FO-TOM-ROLL','Full-On Roll Tom','FULL-ON',{type:'tom',tune:1.15,decay:.55});
DP('FO-RIM-CLICK','Full-On Click Rim','FULL-ON',{type:'rim',tune:1.05,tone:1.3});
DP('FO-SHK-GROOVE','Full-On Groove Shaker','FULL-ON',{type:'shaker',decay:.55,tone:1.2});
DP('FO-GLITCH-EDGE','Full-On Edge Glitch','FULL-ON',{type:'glitch',tone:1.1,decay:.8});
DP('FO-ZAP-ARC','Full-On Arc Zap','FULL-ON',{type:'zap',tune:1.1,decay:.75});
DP('FO-IMPACT-LIFT','Full-On Lift Impact','FULL-ON',{type:'impact',tune:.95,decay:.85});
/* TECHNO drums (v0.12.0 additions) */
DP('TE-KICK2-STEEL','Techno Steel Kick','TECHNO',{type:'kick',tune:1.05,decay:.5,punch:.85});
DP('TE-KICK2-DEEP','Techno Deep Kick','TECHNO',{type:'kick',tune:.7,decay:1.35,punch:.3});
DP('TE-KICK2-CLUB','Techno Club Kick','TECHNO',{type:'kick',tune:.95,decay:.8,punch:.65});
DP('TE-SNARE2-RAW','Techno Raw Snare','TECHNO',{type:'snare',tune:.95,decay:.55,tone:1.05,punch:.5});
DP('TE-CLAP2-DRY','Techno Dry Clap','TECHNO',{type:'clap',decay:.55,tone:.85});
DP('TE-HAT2-CHATTER','Techno Chatter Hat','TECHNO',{type:'hatC',decay:.35,tone:1.35});
DP('TE-HAT2-SIZZLE','Techno Sizzle Open Hat','TECHNO',{type:'hatO',decay:.8,tone:1.3});
DP('TE-CONGA-WAREHOUSE','Techno Warehouse Conga','TECHNO',{type:'conga',tune:.9,decay:.8});
DP('TE-RIM2-CLAVE','Techno Clave Rim','TECHNO',{type:'rim',tune:1.2,tone:1.5});
DP('TE-COW-INDUSTRIAL','Techno Industrial Cowbell','TECHNO',{type:'cowbell',tune:.95,tone:1.1});
DP('TE-CLAVE-WOOD','Techno Wood Clave','TECHNO',{type:'clave',tune:1});
DP('TE-SHK2-METAL','Techno Metal Shaker','TECHNO',{type:'shaker',decay:.45,tone:1.35});
DP('TE-ZAP2-SONAR','Techno Sonar Zap','TECHNO',{type:'zap',tune:.8,decay:.9});
DP('TE-BOOM2-VAULT','Techno Vault Boom','TECHNO',{type:'boom',tune:.85,decay:1.2});
/* TRANCE drums (v0.12.0 additions) */
DP('TR-KICK2-UPIFT','Trance Uplift Kick','TRANCE',{type:'kick',tune:1,decay:.7,punch:.8});
DP('TR-KICK2-ROUND','Trance Round Kick','TRANCE',{type:'kick',tune:.85,decay:.95,punch:.55});
DP('TR-SNARE2-BIG','Trance Big Snare','TRANCE',{type:'snare',tune:1.05,decay:.9,tone:1.1,punch:.45});
DP('TR-CLAP2-WIDE','Trance Wide Clap','TRANCE',{type:'clap',decay:1.4,tone:1.05});
DP('TR-HAT2-GLASS','Trance Glass Hat','TRANCE',{type:'hatC',decay:.32,tone:1.4});
DP('TR-HAT2-SKY','Trance Sky Open Hat','TRANCE',{type:'hatO',decay:.7,tone:1.05});
DP('TR-CONGA-ISLE','Trance Isle Conga','TRANCE',{type:'conga',tune:1.05,decay:.85});
DP('TR-TOM-ASCENT','Trance Ascent Tom','TRANCE',{type:'tom',tune:1.25,decay:.65});
DP('TR-COW-CLASSIC','Trance Classic Cowbell','TRANCE',{type:'cowbell',tune:1.05,tone:1});
DP('TR-SHK2-SILK','Trance Silk Shaker','TRANCE',{type:'shaker',decay:.6,tone:.9});
DP('TR-ZAP2-NEON','Trance Neon Zap','TRANCE',{type:'zap',tune:1.05,decay:.7});
DP('TR-BOOM2-CLOUD','Trance Cloud Boom','TRANCE',{type:'boom',tune:.95,decay:1});
/* PROGRESSIVE drums (v0.12.0 additions) */
DP('PR-KICK2-SILK','Prog Silk Kick','PROGRESSIVE',{type:'kick',tune:.85,decay:.85,punch:.45});
DP('PR-KICK2-MARBLE','Prog Marble Kick','PROGRESSIVE',{type:'kick',tune:.95,decay:.65,punch:.6});
DP('PR-SNARE2-BRUSH','Prog Brush Snare','PROGRESSIVE',{type:'snare',tune:.9,decay:.8,tone:.85,punch:.2});
DP('PR-CLAP2-SOFT','Prog Soft Clap','PROGRESSIVE',{type:'clap',decay:1,tone:.8});
DP('PR-HAT2-MIST','Prog Mist Hat','PROGRESSIVE',{type:'hatC',decay:.45,tone:.85});
DP('PR-HAT2-DRIFT','Prog Drift Open Hat','PROGRESSIVE',{type:'hatO',decay:.9,tone:.8});
DP('PR-CONGA-EARTH','Prog Earth Conga','PROGRESSIVE',{type:'conga',tune:.8,decay:1.05});
DP('PR-BONGO-WARM','Prog Warm Bongo','PROGRESSIVE',{type:'bongo',tune:.9,decay:.8});
DP('PR-COW-DEEP','Prog Deep Cowbell','PROGRESSIVE',{type:'cowbell',tune:.8,tone:.9});
DP('PR-CLAVE-NIGHT','Prog Night Clave','PROGRESSIVE',{type:'clave',tune:.9});
DP('PR-SHK2-GROVE','Prog Grove Shaker','PROGRESSIVE',{type:'shaker',decay:.7,tone:.8});
DP('PR-BOOM2-TIDE','Prog Tide Boom','PROGRESSIVE',{type:'boom',tune:.9,decay:1.15});
/* HI-TECH drums */
DP('HT-KICK-PULSE','Hi-Tech Pulse Kick','HI-TECH',{type:'kick',tune:1,decay:.48,punch:1});
DP('HT-KICK-IRON','Hi-Tech Iron Kick','HI-TECH',{type:'kick',tune:.9,decay:.65,punch:.85});
DP('HT-SNARE-RAZOR','Hi-Tech Razor Snare','HI-TECH',{type:'snare',tune:1.3,decay:.45,tone:1.55,punch:.9});
DP('HT-CLAP-STATIC','Hi-Tech Static Clap','HI-TECH',{type:'clap',decay:.5,tone:1.5});
DP('HT-HAT-BLITZ','Hi-Tech Blitz Hat','HI-TECH',{type:'hatC',decay:.22,tone:1.8});
DP('HT-HAT-FLICKER','Hi-Tech Flicker Hat','HI-TECH',{type:'hatC',decay:.4,tone:1.45});
DP('HT-HAT-STRATOS','Hi-Tech Stratos Open Hat','HI-TECH',{type:'hatO',decay:1,tone:1.35});
DP('HT-CONGA-CIRCUIT','Hi-Tech Circuit Conga','HI-TECH',{type:'conga',tune:1.2,decay:.6});
DP('HT-BONGO-CHIP','Hi-Tech Chip Bongo','HI-TECH',{type:'bongo',tune:1.35,decay:.5});
DP('HT-RIM-QUANTUM','Hi-Tech Quantum Rim','HI-TECH',{type:'rim',tune:1.4,tone:1.7});
DP('HT-GLITCH-BURST','Hi-Tech Burst Glitch','HI-TECH',{type:'glitch',tone:1.5,decay:1});
DP('HT-ZAP-TERMINAL','Hi-Tech Terminal Zap','HI-TECH',{type:'zap',tune:1.35,decay:.85});
DP('HT-BOOM-CORE','Hi-Tech Core Boom','HI-TECH',{type:'boom',tune:.8,decay:1.3});
DP('HT-IMPACT-REACTOR','Hi-Tech Reactor Impact','HI-TECH',{type:'impact',tune:1.05,decay:1});
/* ── synth additions for the new genres ── */
SP('bass','DR-BASS-GRINDER','Dark Grinder Bass','DARK-PSY',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:16,cutoff:950,res:11,gate:.35,dec:.11,sus:.2,poly:2});
SP('lead','DR-LEAD-HOWL','Dark Howl Lead','DARK-PSY',{wave1:'square',wave2:'sawtooth',detune:12,cutoff:2100,res:13,gate:.5,dec:.2,sus:.4,poly:4});
SP('pad','DR-PAD-ABYSS','Dark Abyss Pad','DARK-PSY',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:20,cutoff:620,atk:.9,rel:1.6,gate:2.8,poly:8});
SP('arp','DR-ARP-SPIKE','Dark Spike Arp','DARK-PSY',{wave1:'square',wave2:'sawtooth',detune:9,cutoff:1600,res:12,gate:.22,dec:.09,sus:.18,poly:4});
SP('bass','GO-BASS-SPIRAL','Goa Spiral Bass','GOA',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:6,cutoff:780,res:9,gate:.32,dec:.1,sus:.22,poly:2});
SP('lead','GO-LEAD-CRYSTAL','Goa Crystal Lead','GOA',{wave1:'sawtooth',wave2:'sine',detune:10,cutoff:2800,res:9,gate:.6,dec:.24,sus:.45,poly:6});
SP('pad','GO-PAD-SUNRISE','Goa Sunrise Pad','GOA',{wave1:'sawtooth',wave2:'sine',oct2:1,detune:13,cutoff:1500,atk:.8,rel:1.5,lfoRate:.35,lfoDepth:.35,lfoDest:'cutoff',gate:2.7,poly:8});
SP('arp','GO-ARP-LADDER','Goa Ladder Arp','GOA',{wave1:'sawtooth',wave2:'triangle',detune:7,cutoff:2000,res:10,gate:.26,dec:.11,sus:.24,poly:4});
SP('bass','FO-BASS-ENGINE','Full-On Engine Bass','FULL-ON',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:5,cutoff:720,res:9,gate:.3,dec:.1,sus:.2,poly:2});
SP('lead','FO-LEAD-SOAR','Full-On Soar Lead','FULL-ON',{wave1:'sawtooth',wave2:'sawtooth',detune:16,cutoff:2600,res:8,gate:.65,dec:.26,sus:.5,poly:6});
SP('pad','FO-PAD-LIFT','Full-On Lift Pad','FULL-ON',{wave1:'sawtooth',wave2:'sawtooth',detune:15,cutoff:1600,atk:.75,rel:1.4,lfoRate:.25,lfoDepth:.3,lfoDest:'cutoff',gate:2.7,poly:8});
SP('arp','FO-ARP-SPARK','Full-On Spark Arp','FULL-ON',{wave1:'square',wave2:'sawtooth',detune:8,cutoff:1900,res:10,gate:.24,dec:.1,sus:.2,poly:4});
SP('bass','HT-BASS-FRACTURE','Hi-Tech Fracture Bass','HI-TECH',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:14,cutoff:1000,res:12,gate:.28,dec:.09,sus:.16,poly:2});
SP('lead','HT-LEAD-VIRUS','Hi-Tech Virus Lead','HI-TECH',{wave1:'square',wave2:'square',detune:14,cutoff:2300,res:14,gate:.45,dec:.18,sus:.38,poly:4});
SP('pad','HT-PAD-STATIC','Hi-Tech Static Pad','HI-TECH',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:22,cutoff:800,atk:.85,rel:1.55,gate:2.8,poly:8});
SP('arp','HT-ARP-GLITCH','Hi-Tech Glitch Arp','HI-TECH',{wave1:'square',wave2:'square',detune:5,cutoff:1700,res:13,gate:.2,dec:.08,sus:.16,poly:4});
/* ── v0.12.0 P2: layered kits — full drum-row + role assignments per genre
   (the composer maps roles {kick,snare,hat,perc,bass,lead,pad,arp,fx} →
   preset ids; Phase 4 swaps COMPOSER_STYLES over to these) ── */
const KITS={
'PSYTRANCE':{kick:'PS-KICK-TIGHT',snare:'PS-SNARE2-CRACK',hat:'PS-HAT2-TICK',perc:'PS-CONGA-LOW',bass:'PS-BASS-ROLL',lead:'PS-LEAD-SQUELCH',pad:'PS-PAD-PSYCH',arp:'PS-ARP-ACID',fx:'FX-PS-RISE'},
'DARK-PSY':{kick:'DR-KICK-HAMMER',snare:'DR-SNARE-WHIP',hat:'DR-HAT-NEEDLE',perc:'DR-CONGA-GRAVE',bass:'DR-BASS-GRINDER',lead:'DR-LEAD-HOWL',pad:'DR-PAD-ABYSS',arp:'DR-ARP-SPIKE',fx:'FX-PS-RISE'},
'GOA':{kick:'GO-KICK-GLOW',snare:'GO-SNARE-RING',hat:'GO-HAT-SILVER',perc:'GO-CONGA-RITUAL',bass:'GO-BASS-SPIRAL',lead:'GO-LEAD-CRYSTAL',pad:'GO-PAD-SUNRISE',arp:'GO-ARP-LADDER',fx:'FX-PS-RISE'},
'FULL-ON':{kick:'FO-KICK-DRIVE',snare:'FO-SNARE-SNAP',hat:'FO-HAT-SPARK',perc:'FO-CONGA-PUSH',bass:'FO-BASS-ENGINE',lead:'FO-LEAD-SOAR',pad:'FO-PAD-LIFT',arp:'FO-ARP-SPARK',fx:'FX-PS-RISE'},
'TECHNO':{kick:'TE-KICK2-CLUB',snare:'TE-SNARE2-RAW',hat:'TE-HAT2-CHATTER',perc:'TE-CONGA-WAREHOUSE',bass:'TE-BASS-RUMBLE',lead:'TE-LEAD-ACID',pad:'TE-PAD-DARK',arp:'TE-ARP-HYPNO',fx:'FX-TE-RISE'},
'TRANCE':{kick:'TR-KICK2-UPIFT',snare:'TR-CLAP2-WIDE',hat:'TR-HAT2-GLASS',perc:'TR-CONGA-ISLE',bass:'TR-BASS-OFFBEAT',lead:'TR-LEAD-SAW',pad:'TR-PAD-ATMO',arp:'TR-ARP-ROLL',fx:'FX-TR-IMPACT'},
'PROGRESSIVE':{kick:'PR-KICK2-SILK',snare:'PR-SNARE2-BRUSH',hat:'PR-HAT2-MIST',perc:'PR-CONGA-EARTH',bass:'PR-BASS-WARM',lead:'PR-LEAD-MELODIC',pad:'PR-PAD-EVOLVE',arp:'PR-ARP-MELODIC',fx:'FX-TE-RISE'},
'HI-TECH':{kick:'HT-KICK-PULSE',snare:'HT-SNARE-RAZOR',hat:'HT-HAT-BLITZ',perc:'HT-CONGA-CIRCUIT',bass:'HT-BASS-FRACTURE',lead:'HT-LEAD-VIRUS',pad:'HT-PAD-STATIC',arp:'HT-ARP-GLITCH',fx:'FX-TE-RISE'},
};

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
/* DEFAULTS.TRACKS (8) — the historical default; LIMITS.MAX_TRACKS (16) is only
   a ceiling reachable via the explicit +TRACK action */
for(let t=0;t<DEFAULTS.TRACKS;t++)p.tracks.push({idx:t,kind:t<4?'drum':'synth',name:names[t],
sound:{},presetId:'',mix:{vol:.8,pan:0,mute:false,solo:false,sendA:0,sendB:0},
scAmount:0,scAttackMs:12,scHoldMs:0,scReleaseMs:140});
}
/* +TRACK (v0.5.0 UNLIMIT): grows a project by one track up to LIMITS.MAX_TRACKS.
   Every existing pattern gets a default 16-step entry for the new index (a
   pattern only sounds where steps are on, so this is inaudible); the new track
   starts with the neutral INIT-SYNTH preset. Returns the new index or -1 at cap. */
function addTrackToProject(p){
if(!p||p.tracks.length>=LIMITS.MAX_TRACKS)return -1;
const t=p.tracks.length;
p.tracks.push({idx:t,kind:'synth',name:'TRACK '+(t+1),
sound:Object.assign({},libFind('INIT-SYNTH')),presetId:'INIT-SYNTH',
mix:{vol:.8,pan:0,mute:false,solo:false,sendA:0,sendB:0},
scAmount:0,scAttackMs:12,scHoldMs:0,scReleaseMs:140});
for(const k in p.patterns){const d=p.patterns[k].data;if(!d[t])d[t]={len:DEFAULTS.PATTERN_LEN,steps:Array.from({length:DEFAULTS.PATTERN_LEN},()=>mkStep(false))}}
return t;
}
function buildStyle(style,seed){
const rng=mulberry32(seed||1);
const p=mkProject();initTracks(p);
const A=mkPattern('A',8),B=mkPattern('B',8);
p.patterns={};p.patterns['A']=A;p.patterns['B']=B;
p.scenes=Array.from({length:DEFAULTS.SCENES},(_,i)=>({name:i<2?('SCENE '+(i+1)):'-',pattern:i===0?'A':(i===1?'B':null)}));
p.currentPattern='A';p.activeScene=0;
const put=(pat,t,i,vel,note)=>{const d=pat.data[t],L=d.len,s=d.steps[((i%L)+L)%L];s.on=1;if(vel)s.vel=vel;if(note!=null)s.note=note};
const setLen=(pat,t,l)=>{const d=pat.data[t];const old=d.steps;d.len=l;d.steps=Array.from({length:l},(_,k)=>{const o=old[k%old.length];/* v0.5.0 UNLIMIT fix: lengthening used to SHARE step objects across repeats — editing step 16 silently edited step 0. Clone so every step is independent. */return o?{on:o.on,vel:o.vel,prob:o.prob,micro:o.micro,note:o.note,lock:Object.assign({},o.lock)}:mkStep(false)})};
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

export { libFind, libCount, libFilter, assignPresetToTrack, initTracks, addTrackToProject, buildStyle, KITS };
