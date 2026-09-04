import { mulberry32, SCALES, mkProject, mkPattern, mkStep, deep, LIMITS } from './model.js';
import { DEFAULTS } from './limits.js';


/* ============ factory presets ============ */
const LIB={drum:[],bass:[],lead:[],pad:[],pluck:[],arp:[],fx:[],synth:[],texture:[]};
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
/* ── v0.14.0 P2: DRUM v2 GENERATION — 4 new voices (darbuka/tambourine/
   triangle/downlifter) + the 4 optional drum params (dist/glide/bursts/
   bright). Every value sits inside the engine clamps (DrumVoice.hit;
   tests/drum-v14.test.ts enforces the data layer: the optional fields are
   opt-in per preset — absence remains exact v0.13.1 behavior). ── */
DP('DBK-DUM-GOA','Darbuka Dum Deep','GOA',{type:'darbuka',tune:.72,decay:1.35,tone:.8});
DP('DBK-TEK-GOA','Darbuka Tek Sharp','GOA',{type:'darbuka',tune:1.45,decay:.55,tone:1.5});
DP('DBK-MAQ-GOA','Darbuka Maqsoum','GOA',{type:'darbuka',tune:1.05,decay:.9,tone:1.15});
DP('DBK-DARK-DPSY','Dark Darbuka Skin','DARK-PSY',{type:'darbuka',tune:.85,decay:1.1,tone:.9,punch:.4});
DP('DBK-TEK-DPSY','Dark Darbuka Snap','DARK-PSY',{type:'darbuka',tune:1.3,decay:.6,tone:1.7,punch:.7});
DP('DBK-ROLL-FB','Full-On Darbuka Roll','FULL-ON',{type:'darbuka',tune:1.2,decay:.7,tone:1.3,punch:.55});
DP('DBK-SOLO-FB','Full-On Darbuka Solo','FULL-ON',{type:'darbuka',tune:1,decay:1,tone:1.2});
DP('DBK-PSY-PISTON','Psy Darbuka Piston','PSYTRANCE',{type:'darbuka',tune:1.1,decay:.62,tone:1.25,punch:.6});
DP('DBK-PSY-HOLLOW','Psy Darbuka Hollow','PSYTRANCE',{type:'darbuka',tune:.78,decay:1.25,tone:.75});
DP('TAM-JINGLE-GOA','Goa Tambourine Jingles','GOA',{type:'tambourine',tune:1.15,decay:.85,tone:1.45});
DP('TAM-DARK-DPSY','Dark Tambourine Dry','DARK-PSY',{type:'tambourine',tune:.9,decay:.5,tone:.65});
DP('TAM-TR-BRIGHT','Trance Tambourine','TRANCE',{type:'tambourine',tune:1.05,decay:.9,tone:1.3});
DP('TAM-PR-WARM','Prog Tambourine Warm','PROGRESSIVE',{type:'tambourine',tune:.85,decay:.75,tone:.8});
DP('TAM-FB-LIFT','Full-On Tambourine Lift','FULL-ON',{type:'tambourine',tune:1.2,decay:1,tone:1.4});
DP('TAM-TE-MECH','Techno Mech Tambourine','TECHNO',{type:'tambourine',tune:1.3,decay:.45,tone:1.6});
DP('TRI-DPSY-RING','Dark Triangle Ring','DARK-PSY',{type:'triangle',tune:1.1,decay:1.4});
DP('TRI-TE-MARKER','Techno Triangle Marker','TECHNO',{type:'triangle',tune:.95,decay:.8});
DP('TRI-PR-AIR','Prog Triangle Air','PROGRESSIVE',{type:'triangle',tune:.85,decay:1});
DP('TRI-GOA-SHRILL','Goa Triangle Shrill','GOA',{type:'triangle',tune:1.35,decay:1.2});
DP('TRI-PSY-TICK','Psy Triangle Tick','PSYTRANCE',{type:'triangle',tune:1.5,decay:.35});
DP('DOWN-PSY-DIVE','Psy Downlifter Dive','PSYTRANCE',{type:'downlifter',tune:1,decay:1.2});
DP('DOWN-DPSY-COLLAPSE','Dark Collapse Downlifter','DARK-PSY',{type:'downlifter',tune:.8,decay:1.6});
DP('DOWN-FB-BREAK','Full-On Break Fall','FULL-ON',{type:'downlifter',tune:1.1,decay:.9});
DP('DOWN-HT-VACUUM','Hi-Tech Vacuum Fall','HI-TECH',{type:'downlifter',tune:.9,decay:1.5});
DP('DOWN-TR-LAND','Trance Landing','TRANCE',{type:'downlifter',tune:1.05,decay:1.1});
DP('DOWN-PR-BREATH','Prog Downlifter Breath','PROGRESSIVE',{type:'downlifter',tune:.85,decay:1.35});
DP('TE-KICK-DIST','Techno Distorted Kick','TECHNO',{type:'kick',tune:.95,decay:.9,punch:.85,dist:.75});
DP('TE-KICK-CLIP','Techno Clipped Kick','TECHNO',{type:'kick',tune:1.05,decay:.7,punch:.95,dist:1});
DP('DPSY-KICK-GNARL','Dark Gnarled Kick','DARK-PSY',{type:'kick',tune:.9,decay:1,punch:.8,dist:.6,glide:.3});
DP('HT-KICK-SLEDGE','Hi-Tech Sledge Kick','HI-TECH',{type:'kick',tune:1,decay:.85,punch:.9,dist:.85});
DP('FB-KICK-DRIVE','Full-On Driven Kick','FULL-ON',{type:'kick',tune:.98,decay:.95,punch:.75,dist:.5});
DP('PS-KICK-BEND','Psy Glide Kick','PSYTRANCE',{type:'kick',tune:.92,decay:.8,punch:.7,glide:.7});
DP('TE-KICK-DROP','Techno Drop Kick','TECHNO',{type:'kick',tune:.88,decay:1.1,punch:.5,glide:.9});
DP('DPSY-KICK-SUCK','Dark Suction Kick','DARK-PSY',{type:'kick',tune:.85,decay:1.2,punch:.45,glide:1});
DP('FB-KICK-SWOOP','Full-On Swoop Kick','FULL-ON',{type:'kick',tune:1.02,decay:.75,punch:.8,glide:.55,dist:.25});
DP('TR-KICK-WHAMP','Trance Whomp Kick','TRANCE',{type:'kick',tune:.9,decay:1.05,punch:.6,glide:.45});
DP('TR-CLAP-WIDE6','Trance Wide Clap 6','TRANCE',{type:'clap',tune:1,decay:1.7,tone:.95,bursts:6});
DP('TR-CLAP-TIGHT2','Trance Tight Clap 2','TRANCE',{type:'clap',tune:1.05,decay:.8,tone:1.1,bursts:2});
DP('TE-CLAP-STUTTER','Techno Stutter Clap','TECHNO',{type:'clap',tune:.95,decay:.9,tone:1.2,bursts:5});
DP('PS-CLAP-FLAM','Psy Flam Clap','PSYTRANCE',{type:'clap',tune:1.1,decay:.7,tone:1.15,bursts:3});
DP('FB-CLAP-STACK','Full-On Stack Clap','FULL-ON',{type:'clap',tune:1,decay:1.4,tone:1,bursts:6});
DP('GA-CLAP-ECHO','Goa Echo Clap','GOA',{type:'clap',tune:.98,decay:1.9,tone:.85,bursts:5});
DP('TE-HAT-GLASS','Techno Glass Hat','TECHNO',{type:'hatC',decay:.45,bright:1.7});
DP('TE-HAT-DUSK','Techno Dusk Hat','TECHNO',{type:'hatC',decay:.6,bright:.6,tone:.8});
DP('PS-HAT-SIZZLE','Psy Sizzle Hat','PSYTRANCE',{type:'hatC',decay:.35,tone:1.5,bright:1.8});
DP('GA-HAT-COPPER','Goa Copper Hat','GOA',{type:'hatO',decay:.8,tone:1.2,bright:.7});
DP('HT-HAT-NEEDLE','Hi-Tech Needle Hat','HI-TECH',{type:'hatC',decay:.3,tone:1.6,bright:2});
DP('PR-HAT-SOFT2','Prog Soft Hat II','PROGRESSIVE',{type:'hatC',decay:.6,tone:.7,bright:.55});
DP('PS-ZAP-LASER2','Psy Laser Zap II','PSYTRANCE',{type:'zap',tune:1.4,decay:.9,tone:1.3});
DP('DPSY-ZIP-SCREAM','Dark Screaming Zip','DARK-PSY',{type:'zap',tune:1.6,decay:1.1,tone:1.5});
DP('HT-ZAP-RICOCHET','Hi-Tech Ricochet','HI-TECH',{type:'zap',tune:1.25,decay:.7,tone:1.7});
DP('TE-BOOM-DEPTH','Techno Depth Boom','TECHNO',{type:'boom',tune:.75,decay:1.5});
DP('DPSY-BOOM-ABYSS','Dark Abyss Boom','DARK-PSY',{type:'boom',tune:.65,decay:1.8});
DP('FB-IMPACT-SLAM','Full-On Slam Impact','FULL-ON',{type:'impact',tune:1.1,decay:1.2,punch:.8});
DP('TR-IMPACT-CREST','Trance Crest Impact','TRANCE',{type:'impact',tune:1,decay:1.4});
DP('GA-TOM-TALK','Goa Talking Tom','GOA',{type:'tom',tune:1.3,decay:.7,tone:1.2});
DP('PR-TOM-EARTH','Prog Earth Tom','PROGRESSIVE',{type:'tom',tune:.7,decay:1.3,tone:.7});
DP('HT-CONGA-STRIDE','Hi-Tech Stride Conga','HI-TECH',{type:'conga',tune:1.35,decay:.65,tone:1.3});
DP('GA-BONGO-FLUTTER','Goa Bongo Flutter','GOA',{type:'bongo',tune:1.25,decay:.8,tone:1.35});
DP('TE-SHAKER-MECH','Techno Mech Shaker','TECHNO',{type:'shaker',decay:.55,tone:1.4});
DP('PS-GLITCH-CELL','Psy Cell Glitch','PSYTRANCE',{type:'glitch',tone:1.4,decay:.9});
DP('DPSY-GLITCH-CANCER','Dark Cancer Glitch','DARK-PSY',{type:'glitch',tone:1.8,decay:1.1});
/* ── v0.15.0 P2: PERCUSSION v3 GENERATION — four NEW voices (crash/
   revcym/agogo/timbale) + v3 showcase variants of the rebuilt membrane
   family. Every value sits inside the engine clamps (DrumVoice.hit;
   tests/drum-v15.test.ts enforces the data layer). ── */
DP('CR-PSY-SPLASH','Psy Splash Crash','PSYTRANCE',{type:'crash',tune:1.15,decay:.7,tone:1.2,punch:.5});
DP('CR-DPSY-DOOM','Dark Doom Crash','DARK-PSY',{type:'crash',tune:.8,decay:1.5,tone:.8,punch:.6});
DP('CR-GOA-BLOOM','Goa Bloom Crash','GOA',{type:'crash',tune:1.05,decay:1.2,tone:1.35,punch:.45});
DP('CR-FB-LIFT','Full-On Lift Crash','FULL-ON',{type:'crash',tune:1.1,decay:.9,tone:1.15,punch:.55});
DP('CR-PR-SOFT','Prog Soft Crash','PROGRESSIVE',{type:'crash',tune:.9,decay:1,tone:.85,punch:.3});
DP('CR-TE-RAW','Techno Raw Crash','TECHNO',{type:'crash',tune:1.2,decay:.6,tone:1.5,punch:.7});
DP('RV-PSY-SUCK','Psy Reverse Suck','PSYTRANCE',{type:'revcym',tune:1,decay:1,tone:1.1,punch:.6});
DP('RV-DPSY-VOID','Dark Void Riser','DARK-PSY',{type:'revcym',tune:.85,decay:1.4,tone:.9,punch:.7});
DP('RV-TR-LIFT','Trance Lift Swell','TRANCE',{type:'revcym',tune:1.1,decay:.85,tone:1.25,punch:.5});
DP('RV-GOA-SPIRAL','Goa Spiral Swell','GOA',{type:'revcym',tune:1.2,decay:1.1,tone:1.4,punch:.55});
DP('RV-PR-BLOOM','Prog Bloom Swell','PROGRESSIVE',{type:'revcym',tune:.9,decay:1.25,tone:.8,punch:.4});
DP('AG-GOA-BELL','Goa Agogo Bell','GOA',{type:'agogo',tune:1.1,decay:.9,tone:1.3,punch:.4});
DP('AG-PSY-TICK','Psy Agogo Tick','PSYTRANCE',{type:'agogo',tune:1.35,decay:.5,tone:1.15,punch:.5});
DP('AG-DPSY-IRON','Dark Iron Bell','DARK-PSY',{type:'agogo',tune:.8,decay:1.2,tone:.85,punch:.6});
DP('AG-FB-ROLL','Full-On Agogo Roll','FULL-ON',{type:'agogo',tune:1.2,decay:.7,tone:1.2,punch:.45});
DP('AG-PR-WOOD','Prog Wooden Bell','PROGRESSIVE',{type:'agogo',tune:.9,decay:.85,tone:.9});
DP('TB-FB-SHELL','Full-On Timbale Shell','FULL-ON',{type:'timbale',tune:1.1,decay:.9,tone:1.2,punch:.6});
DP('TB-PSY-LADLE','Psy Timbale Ladle','PSYTRANCE',{type:'timbale',tune:1.25,decay:.6,tone:1.3,punch:.7});
DP('TB-TE-METAL','Techno Metal Timbale','TECHNO',{type:'timbale',tune:.95,decay:.75,tone:1.45,punch:.8});
DP('TB-GOA-BRASS','Goa Brass Timbale','GOA',{type:'timbale',tune:1.05,decay:1,tone:1.1,punch:.5});
DP('TB-DPSY-CLANG','Dark Timbale Clang','DARK-PSY',{type:'timbale',tune:.85,decay:1.15,tone:.9,punch:.65});
DP('TB-HT-SLICE','Hi-Tech Timbale Slice','HI-TECH',{type:'timbale',tune:1.35,decay:.5,tone:1.6,punch:.75});
DP('PS-CONGA2-WOODY','Woody Conga Slap','PSYTRANCE',{type:'conga',tune:.95,decay:.85,tone:1.3,punch:.75});
DP('PR-CONGA2-DEEP','Deep Earth Conga','PROGRESSIVE',{type:'conga',tune:.8,decay:1.3,tone:.8,punch:.3});
DP('GO-CONGA2-OPEN','Open Ritual Conga','GOA',{type:'conga',tune:1.05,decay:1.1,tone:1.1,punch:.5});
DP('PS-BONGO2-SNAP','Snap Bongo','PSYTRANCE',{type:'bongo',tune:1.15,decay:.7,tone:1.35,punch:.8});
DP('FO-BONGO2-SKIN','Full-On Skin Bongo','FULL-ON',{type:'bongo',tune:.95,decay:.9,tone:.9,punch:.4});
DP('TE-TOM2-CANNON','Techno Cannon Tom','TECHNO',{type:'tom',tune:.85,decay:1.2,tone:1.1,punch:.6});
DP('TR-TOM2-808','Trance 808 Tom','TRANCE',{type:'tom',tune:.75,decay:1.4,tone:.9,punch:.35});
DP('PS-COW2-BEAT','Beat Cowbell','PSYTRANCE',{type:'cowbell',tune:1.05,decay:.9,tone:1.35,punch:.5});
DP('TE-COW2-CLUB','Club Cowbell','TECHNO',{type:'cowbell',tune:.95,decay:.7,tone:.85});
DP('PS-CLAVE2-KNOCK','Knock Clave','PSYTRANCE',{type:'clave',tune:1.1,tone:1.2,punch:.7});
DP('HT-CLAVE2-WOOD','Hi-Tech Wood Clave','HI-TECH',{type:'clave',tune:.9,tone:.9,punch:.5});

/* ── v0.13.0 P2: SYNTH v2-lite generation — gen:'v13' marks presets that use
   the new optional engine params (fenv/fdec/penv/pdec/sub). Every value sits
   inside the engine clamps (SynthVoice.noteOn; tests/synth-v2.test.ts enforces
   the data-layer rules: legacy presets carry NO new fields — absence remains
   exact v0.12.0 behavior; gen:'v13' presets must clamp). ── */
SP('bass','FB-ROLL-V13','Full-On Rolling Bass','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'square',oct2:-1,detune:3,cutoff:850,res:10,gate:.28,dec:.1,sus:.3,rel:.05,sub:.55,fenv:5,fdec:.06,poly:2});
SP('bass','FB-OFFBEAT-V13','Full-On Offbeat Bass','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',oct2:-1,detune:6,cutoff:700,res:5,gate:.45,dec:.18,sus:.35,sub:.4,fenv:3,poly:2});
SP('bass','FB-PUNCH-V13','Full-On Punch Bass','FULL-ON',{gen:'v13',wave1:'square',wave2:'sawtooth',cutoff:1100,res:12,gate:.22,dec:.08,sus:.2,fenv:7,fdec:.05,sub:.3,poly:2});
SP('bass','FB-GROWL-V13','Full-On Growl Bass','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:22,cutoff:950,res:14,gate:.35,dec:.14,sus:.3,fenv:6,fdec:.09,sub:.35,lfoRate:5.5,lfoDepth:.12,lfoDest:'cutoff',poly:2});
SP('bass','PSB-ROLL-V13','Psy Rolling Bass','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'square',oct2:-1,detune:4,cutoff:750,res:9,gate:.3,dec:.11,sus:.25,sub:.6,fenv:4,fdec:.07,poly:2});
SP('bass','PSB-DEEP-V13','Psy Deep Bass','PSYTRANCE',{gen:'v13',wave1:'triangle',wave2:'sawtooth',oct2:-1,cutoff:500,res:4,gate:.6,dec:.3,sus:.5,sub:.85,poly:2});
SP('bass','PSB-SCRATCH-V13','Psy Scratch Bass','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'square',detune:9,cutoff:1200,res:15,gate:.3,dec:.1,sus:.2,fenv:9,fdec:.05,poly:2});
SP('bass','DB-SCREECH-V13','Dark Screech Bass','DARK-PSY',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:5,cutoff:1500,res:17,gate:.35,dec:.12,sus:.25,fenv:11,fdec:.05,sub:.2,poly:2});
SP('bass','DB-GNARL-V13','Dark Gnarled Bass','DARK-PSY',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:31,cutoff:700,res:13,gate:.4,dec:.16,sus:.3,fenv:5,fdec:.1,sub:.4,lfoRate:7,lfoDepth:.2,lfoDest:'cutoff',poly:2});
SP('bass','DB-SUBCORE-V13','Dark Subcore','DARK-PSY',{gen:'v13',wave1:'sine',wave2:'sawtooth',cutoff:350,res:2,gate:.8,dec:.4,sus:.7,sub:1,poly:2});
SP('bass','GB-ACID303-V13','Goa Acid 303','GOA',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',cutoff:600,res:18,gate:.3,dec:.15,sus:.15,fenv:12,fdec:.12,poly:2});
SP('bass','GB-SQUELCH-V13','Goa Squelch','GOA',{gen:'v13',wave1:'square',wave2:'square',detune:7,cutoff:800,res:16,gate:.25,dec:.09,sus:.15,fenv:10,fdec:.06,poly:2});
SP('bass','GB-BUZZ-V13','Goa Phrygian Buzz','GOA',{gen:'v13',wave1:'sawtooth',wave2:'square',detune:12,cutoff:1000,res:11,gate:.5,dec:.2,sus:.4,fenv:4,fdec:.1,poly:2});
SP('bass','HB-GLITCH-V13','Hi-Tech Glitch Bass','HI-TECH',{gen:'v13',wave1:'square',wave2:'square',detune:14,cutoff:1400,res:18,gate:.18,dec:.06,sus:.12,fenv:13,fdec:.04,poly:2});
SP('bass','HB-INDUSTRIAL-V13','Hi-Tech Industrial','HI-TECH',{gen:'v13',wave1:'sawtooth',wave2:'square',oct2:-1,detune:8,cutoff:600,res:12,gate:.5,dec:.2,sus:.45,sub:.5,fenv:6,fdec:.12,poly:2});
SP('bass','HB-NEURO-V13','Hi-Tech Neuro Bass','HI-TECH',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:26,cutoff:1100,res:15,gate:.3,dec:.13,sus:.2,fenv:8,fdec:.07,lfoRate:8,lfoDepth:.25,lfoDest:'cutoff',poly:2});
SP('bass','TB-MID-V13','Techno Mid Bass','TECHNO',{gen:'v13',wave1:'sawtooth',wave2:'square',detune:10,cutoff:900,res:7,gate:.4,dec:.18,sus:.35,fenv:4,fdec:.1,poly:2});
SP('bass','TB-DEEP-V13','Techno Deep Bass','TECHNO',{gen:'v13',wave1:'sine',wave2:'sawtooth',oct2:-1,cutoff:300,res:3,gate:.9,dec:.45,sus:.75,sub:.7,poly:2});
SP('bass','TRB-OFF-V13','Trance Offbeat Bass','TRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',oct2:-1,detune:5,cutoff:800,res:6,gate:.4,dec:.16,sus:.3,sub:.45,fenv:4,fdec:.08,poly:2});
SP('bass','TRB-PLUCK-V13','Trance Pluck Bass','TRANCE',{gen:'v13',wave1:'sawtooth',wave2:'square',cutoff:1000,res:9,gate:.22,dec:.09,sus:.18,fenv:8,fdec:.06,sub:.3,poly:2});
SP('bass','PB-DEEP-V13','Prog Deep Bass','PROGRESSIVE',{gen:'v13',wave1:'triangle',wave2:'sawtooth',oct2:-1,detune:5,cutoff:450,res:4,gate:.7,dec:.35,sus:.6,sub:.75,poly:2});
SP('bass','PB-HYPNO-V13','Prog Hypno Bass','PROGRESSIVE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:9,cutoff:650,res:8,gate:.55,dec:.25,sus:.5,fenv:3,fdec:.14,lfoRate:2.2,lfoDepth:.1,lfoDest:'cutoff',poly:2});
SP('lead','FL-ANTHEM-V13','Full-On Anthem Lead','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:18,cutoff:2600,res:4,atk:.01,dec:.25,sus:.65,rel:.25,fenv:5,fdec:.2});
SP('lead','FL-CRYSTAL-V13','Full-On Crystal Lead','FULL-ON',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:9,oct2:1,cutoff:3200,res:6,gate:.5,dec:.2,sus:.5,fenv:6,fdec:.15,poly:4});
SP('lead','DB-RAZOR-V13','Dark Razor Lead','DARK-PSY',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:28,cutoff:2200,res:9,gate:.6,dec:.3,sus:.55,fenv:7,fdec:.18,poly:4});
SP('lead','DB-ACIDLEAD-V13','Dark Acid Lead','DARK-PSY',{gen:'v13',wave1:'sawtooth',wave2:'square',cutoff:1400,res:17,gate:.4,dec:.18,sus:.35,fenv:13,fdec:.14,poly:4});
SP('lead','GB-SCREAM-V13','Goa Screaming Lead','GOA',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:12,cutoff:2800,res:12,gate:.7,dec:.35,sus:.6,fenv:9,fdec:.22,poly:4});
SP('lead','GB-SPACE-V13','Goa Space Lead','GOA',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:6,oct2:1,cutoff:2400,res:8,dec:.4,sus:.6,fenv:6,poly:4});
SP('lead','HB-CHROME-V13','Hi-Tech Chrome Lead','HI-TECH',{gen:'v13',wave1:'square',wave2:'square',detune:16,cutoff:3000,res:14,gate:.45,dec:.22,sus:.5,fenv:8,fdec:.12,poly:4});
SP('lead','TRL-HOOVER-V13','Trance Hoover','TRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:34,cutoff:1800,res:5,dec:.3,sus:.7,fenv:4,fdec:.25,sub:.2});
SP('lead','TRL-UPLIFT-V13','Trance Uplift Lead','TRANCE',{gen:'v13',wave1:'sawtooth',wave2:'square',detune:14,oct2:1,cutoff:3400,res:7,dec:.25,sus:.6,fenv:6,fdec:.16});
SP('lead','TEL-ACID-V13','Techno Acid Lead','TECHNO',{gen:'v13',wave1:'sawtooth',wave2:'square',cutoff:1100,res:19,gate:.35,dec:.14,sus:.3,fenv:14,fdec:.1,poly:4});
SP('lead','PBL-SOFT-V13','Prog Soft Lead','PROGRESSIVE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:11,cutoff:1600,res:3,atk:.03,dec:.4,sus:.7,rel:.4,fenv:3,fdec:.3});
SP('lead','PSL-GLIDE-V13','Psy Glide Lead','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:8,cutoff:2000,res:8,gate:.6,dec:.3,sus:.55,penv:7,pdec:.09,fenv:5,fdec:.2,poly:4});
SP('lead','PSL-HARD-V13','Psy Hard Lead','PSYTRANCE',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:20,cutoff:2500,res:10,gate:.5,dec:.25,sus:.5,fenv:8,fdec:.15,poly:4});
SP('lead','PSL-DRIFT-V13','Psy Drift Lead','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'triangle',detune:15,cutoff:1800,res:5,atk:.05,dec:.5,sus:.7,rel:.5,lfoRate:1.8,lfoDepth:.15,lfoDest:'cutoff'});
SP('pad','FP-WARM-V13','Full-On Warm Pad','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:12,cutoff:1400,res:2,atk:.4,dec:1.2,sus:.85,rel:.8,fenv:2,fdec:.9,poly:4});
SP('pad','DP-BLACK-V13','Dark Black Pad','DARK-PSY',{gen:'v13',wave1:'sawtooth',wave2:'square',detune:20,cutoff:900,res:6,atk:.6,dec:1.5,sus:.8,rel:1.2,fenv:3,fdec:1.1,poly:4});
SP('pad','DP-FREEZE-V13','Dark Freeze Pad','DARK-PSY',{gen:'v13',wave1:'triangle',wave2:'sawtooth',detune:7,cutoff:700,res:3,atk:.9,dec:2,sus:.9,rel:1.5,lfoRate:.4,lfoDepth:.2,lfoDest:'cutoff',poly:4});
SP('pad','GP-MYSTIC-V13','Goa Mystic Pad','GOA',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:16,cutoff:1600,res:5,atk:.5,dec:1.4,sus:.85,rel:1,fenv:3,fdec:1,poly:4});
SP('pad','HP-METAL-V13','Hi-Tech Metal Pad','HI-TECH',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:24,cutoff:1200,res:10,atk:.5,dec:1.3,sus:.8,rel:1.1,poly:4});
SP('pad','TP-STRINGS-V13','Techno Strings Pad','TECHNO',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:10,cutoff:1100,res:2,atk:.3,dec:1,sus:.85,rel:.7,fenv:2,fdec:.8});
SP('pad','PP-DEEP-V13','Prog Deep Pad','PROGRESSIVE',{gen:'v13',wave1:'triangle',wave2:'sawtooth',detune:9,cutoff:800,res:3,atk:.7,dec:1.8,sus:.9,rel:1.4,sub:.25,poly:4});
SP('pad','PSP-SHIMMER-V13','Psy Shimmer Pad','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:22,oct2:1,cutoff:2000,res:4,atk:.6,dec:1.6,sus:.8,rel:1.2,lfoRate:.8,lfoDepth:.12,lfoDest:'cutoff',poly:4});
SP('pluck','FPK-DROP-V13','Full-On Drop Pluck','FULL-ON',{gen:'v13',wave1:'square',wave2:'sawtooth',cutoff:1200,res:11,gate:.15,dec:.07,sus:.1,fenv:10,fdec:.04,poly:4});
SP('pluck','PSK-PLUCK-V13','Psy Pluck','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'square',cutoff:1000,res:9,gate:.18,dec:.08,sus:.12,fenv:8,fdec:.05,poly:4});
SP('pluck','DPK-STAB-V13','Dark Stab Pluck','DARK-PSY',{gen:'v13',wave1:'square',wave2:'square',detune:12,cutoff:1400,res:14,gate:.12,dec:.05,sus:.08,fenv:12,fdec:.035,poly:4});
SP('pluck','GPK-PLUCK-V13','Goa Pluck','GOA',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',cutoff:1100,res:12,gate:.2,dec:.09,sus:.12,fenv:9,fdec:.06,poly:4});
SP('pluck','TPK-PLUCK-V13','Trance Pluck','TRANCE',{gen:'v13',wave1:'sawtooth',wave2:'triangle',cutoff:1300,res:7,gate:.2,dec:.1,sus:.15,fenv:7,fdec:.06,sub:.2,poly:4});
SP('pluck','PPK-SOFT-V13','Prog Soft Pluck','PROGRESSIVE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:8,cutoff:900,res:5,gate:.3,dec:.14,sus:.2,fenv:5,fdec:.09,poly:4});
SP('pluck','HPK-PLUCK-V13','Hi-Tech Pluck','HI-TECH',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:15,cutoff:1600,res:15,gate:.15,dec:.06,sus:.1,fenv:11,fdec:.04,poly:4});
SP('arp','FA-ARP-V13','Full-On Riser Arp','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:10,cutoff:1800,res:9,gate:.2,dec:.1,sus:.2,fenv:6,fdec:.08,poly:4});
SP('arp','DA-ARP-V13','Dark Crawl Arp','DARK-PSY',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:18,cutoff:1200,res:13,gate:.25,dec:.12,sus:.25,fenv:7,fdec:.1,lfoRate:3.3,lfoDepth:.18,lfoDest:'cutoff',poly:4});
SP('arp','GA-ARP-V13','Goa Sequence Arp','GOA',{gen:'v13',wave1:'sawtooth',wave2:'square',detune:7,cutoff:1500,res:11,gate:.22,dec:.09,sus:.18,fenv:8,fdec:.07,poly:4});
SP('arp','HA-ARP-V13','Hi-Tech Stutter Arp','HI-TECH',{gen:'v13',wave1:'square',wave2:'square',detune:11,cutoff:1900,res:16,gate:.15,dec:.06,sus:.12,fenv:10,fdec:.04,poly:4});
SP('arp','TA-ARP-V13','Trance Flight Arp','TRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:13,oct2:1,cutoff:2200,res:6,gate:.3,dec:.15,sus:.3,fenv:5,fdec:.1});
SP('arp','PA-ARP-V13','Prog Flow Arp','PROGRESSIVE',{gen:'v13',wave1:'sawtooth',wave2:'triangle',detune:9,cutoff:1200,res:4,gate:.4,dec:.2,sus:.35,fenv:4,fdec:.14,poly:4});
SP('arp','PSA-ARP-V13','Psy Hypno Arp','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:6,cutoff:1400,res:8,gate:.28,dec:.13,sus:.28,fenv:6,fdec:.09,lfoRate:2.7,lfoDepth:.14,lfoDest:'cutoff',poly:4});
SP('fx','FFX-UP-V13','Full-On Uplifter','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'square',oct2:1,detune:20,cutoff:700,res:9,atk:1.2,dec:3,sus:.95,rel:.8,lfoRate:.4,lfoDepth:1.1,lfoDest:'cutoff',sub:.3,poly:2});
SP('fx','DFX-DOWN-V13','Dark Downlifter','DARK-PSY',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',cutoff:2400,res:12,atk:.02,dec:2.6,sus:.2,rel:1,fenv:4,fdec:2,poly:2});
SP('fx','GFX-SWEEP-V13','Goa Noise Sweep','GOA',{gen:'v13',wave1:'square',wave2:'sawtooth',cutoff:3000,res:16,atk:.05,dec:1.8,sus:.15,rel:.8,fenv:5,fdec:1.7,poly:2});
SP('fx','HFX-ZAPDOWN-V13','Hi-Tech Zap Down','HI-TECH',{gen:'v13',wave1:'square',wave2:'square',cutoff:2800,res:18,atk:.005,dec:.5,sus:.05,rel:.2,fenv:6,fdec:.45,poly:2});
SP('fx','TFX-RAISE-V13','Techno Raiser','TECHNO',{gen:'v13',wave1:'sawtooth',wave2:'square',cutoff:600,res:10,atk:1.4,dec:3,sus:.9,rel:.9,lfoRate:.5,lfoDepth:1,lfoDest:'cutoff',poly:2});
SP('fx','PFX-DIVE-V13','Prog Dive FX','PROGRESSIVE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:15,cutoff:1600,res:7,atk:.02,dec:1.6,sus:.2,rel:.7,fenv:5,fdec:1.5,penv:24,pdec:.6,poly:2});
SP('fx','PSFX-DROP-V13','Psy Sub Drop','PSYTRANCE',{gen:'v13',wave1:'sine',wave2:'sawtooth',cutoff:400,res:2,atk:.005,dec:1.4,sus:.1,rel:.6,sub:1,penv:19,pdec:.5,poly:2});
/* ── v0.18.0 PRESET BATCH (+36: library 345→381) — the standing "richer
   variety" ask (owner: מבחר עשיר). Weighted to the thin side of the
   library (pluck/pad/arp/lead) and to FOREST, which until now rode the
   DARK-PSY kit with zero presets of its own. Purely additive: every id is
   new (uniqueness bun-tested), no pinned id moves. ── */
DP('FO-KICK-CAMO','Forest Camo Kick','FOREST',{type:'kick',tune:.72,decay:1.3,punch:.35});
DP('FO-PERC-TWIG','Forest Twig Perc','FOREST',{type:'clave',tone:1.5,decay:1});
DP('DH-SNARE-CRUSH','Hi-Tech Crush Snare','HI-TECH',{type:'snare',tune:1.25,decay:.5,tone:1.5,punch:.6});
DP('GO-CLAP-DUNE','Goa Dune Clap','GOA',{type:'clap',decay:1.2,tone:1.2});
DP('FU-CONGA-HEAT','Full-On Heat Conga','FULL-ON',{type:'conga',tune:1.25,decay:.55,tone:1.2});
DP('PR-BONGO-SOFT','Prog Soft Bongo','PROGRESSIVE',{type:'bongo',tune:.95,decay:.7,tone:.8});
DP('TR-DARBUKA-SILK','Trance Silk Darbuka','TRANCE',{type:'darbuka',tune:1.1,decay:.6,tone:1.1});
DP('TE-COWBELL-STEEL','Techno Steel Cowbell','TECHNO',{type:'cowbell',tune:1.05,tone:1.3});
DP('DH-CRASH-BLACK','Hi-Tech Black Crash','HI-TECH',{type:'crash',decay:1.4,tone:1.2});
SP('bass','FO-BASS-GATE','Full-On Gate Bass','FULL-ON',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:7,cutoff:850,res:8,gate:.32,dec:.11,sus:.2,poly:2});
SP('bass','DH-BASS-SCREAM','Hi-Tech Scream Bass','HI-TECH',{wave1:'sawtooth',wave2:'sawtooth',oct2:-1,detune:22,cutoff:1500,res:12,gate:.3,poly:2});
SP('bass','GO-BASS-SQUARE','Goa Square Bass','GOA',{wave1:'square',wave2:'sawtooth',oct2:-1,detune:5,cutoff:900,res:7,gate:.45,poly:2});
SP('bass','FU-BASS-SUBPUMP','Full-On Sub Pump','FULL-ON',{wave1:'sine',wave2:'triangle',oct2:-1,cutoff:300,gate:.6,poly:2});
SP('bass','DH-BASS-WOBBLE','Hi-Tech Wobble Bass','HI-TECH',{wave1:'sawtooth',wave2:'square',oct2:-1,detune:9,cutoff:600,res:14,lfoRate:5.5,lfoDepth:.5,lfoDest:'cutoff',gate:.4,poly:2});
SP('bass','FU-BASS-ROLLOCT','Full-On Roll Oct Bass','FULL-ON',{gen:'v18',wave1:'sawtooth',wave2:'square',detune:3,cutoff:1000,res:9,penv:12,pdec:.05,gate:.28,dec:.1,sus:.15,poly:2});
SP('lead','GO-LEAD-TRANCESAW','Goa Trance Saw','GOA',{wave1:'sawtooth',wave2:'sawtooth',detune:16,cutoff:2600,res:5,gate:.5,dec:.3,sus:.5,poly:4});
SP('lead','DH-LEAD-ALIEN','Hi-Tech Alien Lead','HI-TECH',{wave1:'sawtooth',wave2:'square',detune:28,cutoff:2000,res:9,lfoRate:7,lfoDepth:.4,lfoDest:'cutoff',poly:3});
SP('lead','PS-LEAD-HOOVER','Psy Hoover Lead','PSYTRANCE',{gen:'v18',wave1:'sawtooth',wave2:'square',detune:32,cutoff:1700,res:4,penv:9,pdec:.12,gate:.6,poly:3});
SP('lead','TR-LEAD-LEDPLK','Trance LED Pluck Lead','TRANCE',{wave1:'sawtooth',wave2:'triangle',detune:12,cutoff:3000,res:6,gate:.3,dec:.16,sus:.2,poly:4});
SP('lead','FU-LEAD-RAZOR','Full-On Razor Lead','FULL-ON',{wave1:'sawtooth',detune:20,cutoff:2400,res:10,gate:.45,poly:3});
SP('lead','TE-LEAD-METAL','Techno Metal Lead','TECHNO',{wave1:'square',wave2:'sawtooth',oct2:1,detune:4,cutoff:1300,res:16,gate:.35,dec:.12,sus:.25,poly:3});
SP('pad','GO-PAD-SHIMMER','Goa Shimmer Pad','GOA',{wave1:'sawtooth',wave2:'triangle',oct2:1,detune:18,cutoff:1900,res:3,atk:.6,dec:1.2,sus:.8,rel:1.4,gate:2.5,poly:6});
SP('pad','DH-PAD-BLACKVEIL','Hi-Tech Blackveil Pad','HI-TECH',{wave1:'sawtooth',wave2:'sawtooth',oct2:-1,detune:26,cutoff:800,res:6,atk:.9,dec:1.5,sus:.7,rel:1.8,gate:3,poly:6});
SP('pad','FU-PAD-AMBER','Full-On Amber Pad','FULL-ON',{wave1:'triangle',wave2:'sawtooth',detune:12,cutoff:1500,atk:.5,dec:1,sus:.75,rel:1.2,gate:2.2,poly:6});
SP('pad','PR-PAD-MIST','Prog Mist Pad','PROGRESSIVE',{wave1:'sine',wave2:'triangle',detune:8,cutoff:1100,atk:.8,dec:1.6,sus:.85,rel:2,gate:3,poly:6});
SP('pad','FU-PAD-VOCODE','Full-On Vocode Pad','FULL-ON',{wave1:'square',wave2:'square',oct2:-1,detune:14,cutoff:950,res:8,lfoRate:2.5,lfoDepth:.3,lfoDest:'cutoff',atk:.4,dec:1.1,sus:.7,rel:1.1,gate:2,poly:6});
SP('pluck','PS-PLUCK-MORNING','Psy Morning Pluck','PSYTRANCE',{wave1:'sawtooth',wave2:'triangle',detune:9,cutoff:2600,res:7,gate:.25,dec:.12,sus:.08,poly:6});
SP('pluck','GO-PLUCK-SITAR','Goa Sitar Pluck','GOA',{gen:'v18',wave1:'square',wave2:'sawtooth',oct2:1,detune:3,cutoff:2200,res:10,penv:16,pdec:.04,gate:.22,dec:.1,sus:.05,poly:5});
SP('pluck','DH-PLUCK-GLASS','Hi-Tech Glass Pluck','HI-TECH',{wave1:'triangle',wave2:'sine',oct2:1,cutoff:3200,res:5,gate:.18,dec:.09,sus:.05,poly:6});
SP('pluck','FU-PLUCK-SPARK','Full-On Spark Pluck','FULL-ON',{wave1:'sawtooth',wave2:'square',detune:14,cutoff:2800,res:8,gate:.24,dec:.11,sus:.1,poly:6});
SP('pluck','FU-PLUCK-WOOD','Full-On Wood Pluck','FULL-ON',{gen:'v18',wave1:'triangle',wave2:'square',cutoff:1600,res:12,penv:10,pdec:.05,gate:.2,dec:.1,sus:.05,poly:5});
SP('arp','DH-ARP-NEEDLE','Hi-Tech Needle Arp','HI-TECH',{wave1:'square',wave2:'sawtooth',detune:7,cutoff:2400,res:12,gate:.2,dec:.09,sus:.15,poly:4});
SP('arp','GO-ARP-TEMPLE','Goa Temple Arp','GOA',{wave1:'sawtooth',wave2:'triangle',oct2:-1,detune:10,cutoff:1400,res:8,gate:.3,dec:.14,sus:.25,poly:4});
SP('arp','FU-ARP-HELIX','Full-On Helix Arp','FULL-ON',{wave1:'sawtooth',wave2:'sawtooth',detune:19,cutoff:2100,res:6,lfoRate:4,lfoDepth:.35,lfoDest:'cutoff',gate:.26,dec:.12,sus:.2,poly:4});
SP('arp','PR-ARP-GENTLE','Prog Gentle Arp','PROGRESSIVE',{wave1:'triangle',wave2:'sine',detune:5,cutoff:1200,res:4,gate:.4,dec:.2,sus:.35,poly:5});
SP('arp','TR-ARP-CRYSTAL','Trance Crystal Arp','TRANCE',{wave1:'sine',wave2:'triangle',oct2:1,detune:6,cutoff:3000,res:5,gate:.28,dec:.13,sus:.18,poly:5});
SP('fx','TRFX-SWELL-V13','Trance Swell','TRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:12,cutoff:1500,res:5,atk:.8,dec:2,sus:.85,rel:.9,fenv:3,fdec:1.5,poly:2});
SP('fx','FTX-AIR-V13','Full-On Air Texture','FULL-ON',{gen:'v13',wave1:'sawtooth',wave2:'triangle',detune:25,cutoff:2600,res:2,atk:1.2,dec:3,sus:.95,rel:1.5,lfoRate:.25,lfoDepth:.3,lfoDest:'cutoff'});
SP('fx','DTX-VOID-V13','Dark Void Texture','DARK-PSY',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:33,cutoff:700,res:7,atk:1.5,dec:3.5,sus:.9,rel:2,lfoRate:.15,lfoDepth:.4,lfoDest:'cutoff'});
SP('fx','GTX-HISS-V13','Goa Hiss Texture','GOA',{gen:'v13',wave1:'square',wave2:'sawtooth',detune:18,cutoff:4000,res:9,atk:.8,dec:2.5,sus:.85,rel:1.4,lfoRate:.6,lfoDepth:.25,lfoDest:'cutoff'});
SP('fx','PTX-DRONE-V13','Prog Drone','PROGRESSIVE',{gen:'v13',wave1:'triangle',wave2:'sawtooth',detune:6,cutoff:500,res:2,atk:2,dec:4,sus:.95,rel:2.5,sub:.5});
SP('fx','TTP-PULSE-V13','Techno Pulse Texture','TECHNO',{gen:'v13',wave1:'sawtooth',wave2:'square',detune:9,cutoff:800,res:11,atk:.02,dec:.4,sus:.4,rel:.2,gate:.3,poly:2});
SP('fx','PSTX-SPACE-V13','Psy Space Texture','PSYTRANCE',{gen:'v13',wave1:'sawtooth',wave2:'sawtooth',detune:28,oct2:1,cutoff:3000,res:3,atk:1,dec:3,sus:.9,rel:1.8,lfoRate:.35,lfoDepth:.2,lfoDest:'cutoff'});
/* ── v0.19.0 P1: FOREST's own kit — the genre had exactly 2 presets while
   every other genre owned 40-60; now all 9 KITS roles are native FOREST
   voices (kick/snare/hat/conga×2/shaker/glitch drums + bass/lead/pad/arp
   synths + riser/impact FX). Plus thin-category refills: pluck 15→23,
   revcym/downlifter carriers, 4 more congas (the owner's historical pain
   point), 2 bass / 2 lead / 2 pad. Library 381 → 423. gen:'v19' marks the
   presets that opt into the synth-v2 params (penv/pdec) — clamped. ── */
DP('FS-KICK-ROOT','Forest Root Kick','FOREST',{type:'kick',tune:.78,decay:1.05,punch:.5});
DP('FS-KICK-MOSS','Forest Moss Kick','FOREST',{type:'kick',tune:.66,decay:1.5,punch:.28});
DP('FS-SNARE-TWIG','Forest Twig Snare','FOREST',{type:'snare',tune:1.2,decay:.45,tone:1.4});
DP('FS-HAT-FERN','Forest Fern Hat','FOREST',{type:'hatC',decay:.28,tone:1.7});
DP('FS-CONGA-ROOT','Forest Root Conga','FOREST',{type:'conga',tune:.95,decay:.7,tone:1.2});
DP('FS-CONGA-VINE','Forest Vine Conga','FOREST',{type:'conga',tune:1.25,decay:.55,tone:1.45});
DP('FS-PERC-DRIP','Forest Drip Perc','FOREST',{type:'shaker',tune:1.1,decay:.4});
DP('FS-GLITCH-SPORE','Forest Spore Glitch','FOREST',{type:'glitch',tone:.85,decay:.9});
DP('FX-FS-RISE','Forest Riser','FOREST',{type:'riser'});
DP('FX-FS-IMPACT','Forest Impact','FOREST',{type:'impact'});
SP('bass','FS-BASS-LICHEN','Forest Lichen Bass','FOREST',{gen:'v19',wave1:'sawtooth',wave2:'square',detune:10,cutoff:900,res:7,atk:.004,dec:.22,sus:.5,rel:.14,gate:.5,sub:.4});
SP('bass','FS-BASS-UNDERGROWTH','Forest Undergrowth Bass','FOREST',{gen:'v19',wave1:'sawtooth',wave2:'sawtooth',detune:14,cutoff:700,res:10,atk:.003,dec:.3,sus:.55,rel:.12,gate:.45,penv:5,pdec:.09});
SP('lead','FS-LEAD-BARK','Forest Bark Lead','FOREST',{wave1:'sawtooth',wave2:'square',detune:16,cutoff:2200,res:12,atk:.004,dec:.25,sus:.55,rel:.18,gate:.5,lfoRate:5.5,lfoDepth:.09,lfoDest:'cutoff'});
SP('lead','FS-LEAD-CANOPY','Forest Canopy Lead','FOREST',{gen:'v19',wave1:'square',wave2:'sawtooth',detune:9,cutoff:3200,res:6,atk:.01,dec:.4,sus:.6,rel:.3,gate:.6,penv:8,pdec:.16});
SP('pad','FS-PAD-MOSS','Forest Moss Pad','FOREST',{wave1:'sawtooth',wave2:'triangle',detune:12,cutoff:1100,res:3,atk:1.6,dec:3,sus:.85,rel:2.2,lfoRate:.4,lfoDepth:.18,lfoDest:'cutoff'});
SP('pad','FS-PAD-FOG','Forest Fog Pad','FOREST',{wave1:'triangle',wave2:'sawtooth',detune:20,cutoff:800,res:5,atk:2.2,dec:4,sus:.9,rel:3,lfoRate:.25,lfoDepth:.22,lfoDest:'cutoff'});
SP('arp','FS-ARP-BRANCH','Forest Branch Arp','FOREST',{wave1:'sawtooth',wave2:'square',detune:11,cutoff:2600,res:8,atk:.003,dec:.16,sus:.35,rel:.1,gate:.3,poly:4});
SP('arp','FS-ARP-SPORE','Forest Spore Arp','FOREST',{gen:'v19',wave1:'square',wave2:'sawtooth',detune:7,cutoff:3400,res:9,atk:.002,dec:.12,sus:.3,rel:.08,gate:.25,poly:4,penv:6,pdec:.1});
SP('pluck','PL-PS-FAERY','Psy Faery Pluck','PSYTRANCE',{gen:'v19',wave1:'sawtooth',wave2:'triangle',detune:12,cutoff:2800,res:9,atk:.002,dec:.14,sus:.1,rel:.12,gate:.25,penv:7,pdec:.1});
SP('pluck','PL-FO-GLINT','Full-On Glint Pluck','FULL-ON',{wave1:'square',wave2:'sawtooth',detune:8,cutoff:3200,res:6,atk:.002,dec:.12,sus:.15,rel:.1,gate:.22});
SP('pluck','PL-GO-HARP','Goa Harp Pluck','GOA',{wave1:'triangle',wave2:'sawtooth',detune:6,cutoff:3600,res:4,atk:.002,dec:.2,sus:.12,rel:.18,gate:.3});
SP('pluck','PL-TR-DROP','Trance Drop Pluck','TRANCE',{gen:'v19',wave1:'sawtooth',wave2:'sawtooth',detune:15,cutoff:2400,res:8,atk:.002,dec:.16,sus:.1,rel:.14,gate:.25,penv:9,pdec:.12});
SP('pluck','PL-DR-THORN','Dark Thorn Pluck','DARK-PSY',{wave1:'square',wave2:'square',detune:19,cutoff:1800,res:13,atk:.002,dec:.1,sus:.1,rel:.09,gate:.2});
SP('pluck','PL-PR-DEW','Prog Dew Pluck','PROGRESSIVE',{wave1:'triangle',wave2:'triangle',detune:5,cutoff:1600,res:3,atk:.004,dec:.24,sus:.2,rel:.2,gate:.35});
SP('pluck','PL-HT-SHARD','Hi-Tech Shard Pluck','HI-TECH',{wave1:'sawtooth',wave2:'square',detune:22,cutoff:4200,res:14,atk:.001,dec:.08,sus:.08,rel:.07,gate:.18});
SP('pluck','PL-TE-METAL','Techno Metal Pluck','TECHNO',{wave1:'square',wave2:'sawtooth',detune:10,cutoff:2000,res:11,atk:.001,dec:.11,sus:.12,rel:.1,gate:.2});
DP('FX-PS-REV','Psy Reverse Swell','PSYTRANCE',{type:'revcym'});
DP('FX-FO-REV','Full-On Reverse Swell','FULL-ON',{type:'revcym'});
DP('FX-GO-IMP','Goa Ritual Impact','GOA',{type:'impact'});
DP('FX-PR-DOWN','Prog Downlifter','PROGRESSIVE',{type:'downlifter'});
DP('FX-HT-DOWN','Hi-Tech Downlifter','HI-TECH',{type:'downlifter'});
DP('FX-TE-REV','Techno Reverse Air','TECHNO',{type:'revcym'});
DP('GO-CONGA-DEEP','Goa Deep Conga','GOA',{type:'conga',tune:.8,decay:.9,tone:1.1});
DP('TR-CONGA-SAND','Trance Sand Conga','TRANCE',{type:'conga',tune:1.1,decay:.5,tone:1.3});
DP('TE-CONGA-GHOST','Techno Ghost Conga','TECHNO',{type:'conga',tune:.9,decay:.65,tone:1.5});
DP('FO-CONGA-GLADE','Full-On Glade Conga','FULL-ON',{type:'conga',tune:1.05,decay:.6,tone:1.25});
SP('bass','TE-BASS-PULSE','Techno Pulse Bass','TECHNO',{gen:'v19',wave1:'square',wave2:'sawtooth',detune:5,cutoff:600,res:8,atk:.003,dec:.28,sus:.5,rel:.1,gate:.4,sub:.5});
SP('bass','TR-BASS-PLUCK','Trance Pluck Bass','TRANCE',{wave1:'sawtooth',wave2:'triangle',detune:7,cutoff:1200,res:6,atk:.002,dec:.2,sus:.3,rel:.12,gate:.35});
SP('lead','FO-LEAD-SOLAR','Full-On Solar Lead','FULL-ON',{gen:'v19',wave1:'sawtooth',wave2:'sawtooth',detune:13,cutoff:3800,res:7,atk:.005,dec:.3,sus:.6,rel:.22,gate:.55,penv:10,pdec:.18});
SP('lead','PR-LEAD-VIBE','Prog Vibe Lead','PROGRESSIVE',{wave1:'triangle',wave2:'sawtooth',detune:6,cutoff:2400,res:4,atk:.01,dec:.35,sus:.5,rel:.3,gate:.5});
SP('pad','HT-PAD-RUST','Hi-Tech Rust Pad','HI-TECH',{wave1:'sawtooth',wave2:'square',detune:24,cutoff:1400,res:9,atk:1.4,dec:2.8,sus:.8,rel:2,lfoRate:.5,lfoDepth:.3,lfoDest:'cutoff'});
SP('pad','GO-PAD-MIRAGE','Goa Mirage Pad','GOA',{wave1:'sawtooth',wave2:'triangle',detune:15,cutoff:1800,res:6,atk:1.8,dec:3.2,sus:.85,rel:2.4,lfoRate:.3,lfoDepth:.2,lfoDest:'cutoff'});
/* ── v0.25.0 P1: STRATIFICATION II — fill the cells the owner called out
   ("不要每个功能只有孤零零几个选项"): texture was a category with ZERO
   factory presets (the soundBank TEXTURES never reached the runtime LIB),
   synth had exactly 1, FOREST sat at 22 while siblings owned 45-62, and the
   filter dimension was 75× lowpass vs 2× bandpass. This batch adds 33
   presets spanning the missing dimensions: 9 textures (one per genre),
   5 synth utility voices, 10 FOREST deepening voices (22→32), 6 BANDPASS
   acid basses (the psyreason 8e97cd6 "bass acid bandpass" dimension,
   exceeded: 6 genres × distinct res/fenv laws), 4 WIDE pads (detune 24-30
   = the stereo-width dimension psyreason ships as pad "stereo width").
   Library 423 → 456. gen:'v25' marks presets that use synth-v2 params
   (penv/pdec/fType) — engine clamps. ── */
SP('texture','TX-PS-NIGHT','Psy Night Texture','PSYTRANCE',{gen:'v25',wave1:'sawtooth',wave2:'sawtooth',detune:26,cutoff:2400,res:4,atk:2.4,dec:3,sus:.9,rel:2.8,lfoRate:.3,lfoDepth:.24,lfoDest:'cutoff',poly:4});
SP('texture','TX-FO-DAWN','Full-On Dawn Texture','FULL-ON',{gen:'v25',wave1:'triangle',wave2:'sawtooth',detune:14,cutoff:3200,res:3,atk:2,dec:3,sus:.88,rel:2.4,lfoRate:.4,lfoDepth:.18,lfoDest:'cutoff',poly:4});
SP('texture','TX-DR-ABYSS','Dark Abyss Texture','DARK-PSY',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:30,cutoff:900,res:5,atk:2.8,dec:3.4,sus:.92,rel:3,lfoRate:.18,lfoDepth:.3,lfoDest:'cutoff',poly:4});
SP('texture','TX-FS-AIR','Forest Air Texture','FOREST',{gen:'v25',wave1:'triangle',wave2:'triangle',detune:8,cutoff:1400,res:3,atk:2.6,dec:3.2,sus:.9,rel:2.8,lfoRate:.22,lfoDepth:.2,lfoDest:'cutoff',poly:4});
SP('texture','TX-HT-STATIC','Hi-Tech Static Texture','HI-TECH',{gen:'v25',wave1:'square',wave2:'sawtooth',detune:20,cutoff:5200,res:12,atk:1.2,dec:2.4,sus:.85,rel:2,lfoRate:1.2,lfoDepth:.35,lfoDest:'cutoff',poly:4});
SP('texture','TX-GO-SHIMMER','Goa Shimmer Texture','GOA',{gen:'v25',wave1:'sawtooth',wave2:'triangle',oct2:1,detune:16,cutoff:4600,res:4,atk:2.2,dec:3,sus:.88,rel:2.6,lfoRate:.5,lfoDepth:.22,lfoDest:'cutoff',poly:4});
SP('texture','TX-TE-IRON','Techno Iron Texture','TECHNO',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:11,cutoff:700,res:8,atk:1.8,dec:2.8,sus:.9,rel:2.4,lfoRate:.25,lfoDepth:.28,lfoDest:'cutoff',poly:4});
SP('texture','TX-TR-CLOUD','Trance Cloud Texture','TRANCE',{gen:'v25',wave1:'triangle',wave2:'sawtooth',oct2:1,detune:18,cutoff:2800,res:3,atk:2.4,dec:3,sus:.9,rel:2.6,lfoRate:.3,lfoDepth:.16,lfoDest:'cutoff',poly:4});
SP('texture','TX-PR-RIVER','Prog River Texture','PROGRESSIVE',{gen:'v25',wave1:'triangle',wave2:'triangle',detune:6,cutoff:1000,res:3,atk:3,dec:3.6,sus:.92,rel:3,lfoRate:.15,lfoDepth:.2,lfoDest:'cutoff',poly:4});
SP('synth','SN-PS-ZAPPER','Psy Zapper','PSYTRANCE',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:6,cutoff:5200,res:15,gate:.18,dec:.1,sus:.15,rel:.08,fenv:12,fdec:.04,penv:11,pdec:.05,poly:2});
SP('synth','SN-GO-SCREAMER','Goa Screamer','GOA',{gen:'v25',wave1:'sawtooth',wave2:'sawtooth',detune:8,cutoff:6000,res:10,gate:.25,dec:.14,sus:.2,rel:.1,fenv:9,fdec:.08,poly:2});
SP('synth','SN-DR-GNARL','Dark Gnarl Synth','DARK-PSY',{gen:'v25',wave1:'square',wave2:'square',detune:33,cutoff:1100,res:18,gate:.4,dec:.2,sus:.35,rel:.15,lfoRate:7,lfoDepth:.25,lfoDest:'cutoff',poly:2});
SP('synth','SN-HT-STAB','Hi-Tech Stab','HI-TECH',{gen:'v25',wave1:'square',wave2:'sawtooth',detune:12,cutoff:3800,res:13,gate:.12,dec:.07,sus:.1,rel:.06,fenv:14,fdec:.05,penv:14,pdec:.04,poly:3});
SP('synth','SN-TE-BRUTE','Techno Brute','TECHNO',{gen:'v25',wave1:'sawtooth',wave2:'square',oct2:-1,detune:4,cutoff:900,res:6,gate:.6,dec:.3,sus:.5,rel:.14,sub:.6,poly:2});
SP('bass','FS-BASS-MYCELIUM','Forest Mycelium Bass','FOREST',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:9,cutoff:750,res:9,atk:.004,dec:.26,sus:.5,rel:.13,gate:.48,sub:.45,penv:4,pdec:.11,poly:2});
SP('bass','FS-BASS-HOLLOW','Forest Hollow Bass','FOREST',{gen:'v25',wave1:'triangle',wave2:'sine',oct2:-1,cutoff:420,res:3,atk:.006,dec:.4,sus:.6,rel:.18,gate:.65,sub:.8,poly:2});
SP('lead','FS-LEAD-WILLOW','Forest Willow Lead','FOREST',{gen:'v25',wave1:'triangle',wave2:'sawtooth',detune:11,cutoff:2600,res:7,atk:.012,dec:.32,sus:.55,rel:.22,gate:.55,lfoRate:4.2,lfoDepth:.08,lfoDest:'cutoff',penv:6,pdec:.14});
SP('lead','FS-LEAD-BRACKEN','Forest Bracken Lead','FOREST',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:18,cutoff:2900,res:10,atk:.005,dec:.24,sus:.5,rel:.16,gate:.5,penv:8,pdec:.1});
SP('pad','FS-PAD-UNDERCANOPY','Forest Undercanopy Pad','FOREST',{gen:'v25',wave1:'sawtooth',wave2:'triangle',detune:24,cutoff:1300,res:4,atk:2,dec:3.2,sus:.86,rel:2.6,lfoRate:.28,lfoDepth:.2,lfoDest:'cutoff'});
SP('pad','FS-PAD-MIST','Forest Mist Pad','FOREST',{gen:'v25',wave1:'triangle',wave2:'sawtooth',detune:28,cutoff:950,res:5,atk:2.4,dec:3.6,sus:.9,rel:3,lfoRate:.2,lfoDepth:.24,lfoDest:'cutoff'});
SP('pluck','PL-FS-DEWDROP','Forest Dewdrop Pluck','FOREST',{gen:'v25',wave1:'triangle',wave2:'sine',detune:7,cutoff:3000,res:6,atk:.002,dec:.15,sus:.1,rel:.13,gate:.24,penv:7,pdec:.09});
DP('FX-FS-DOWN','Forest Downlifter','FOREST',{type:'downlifter'});
DP('FX-FS-AIR','Forest Reverse Air','FOREST',{type:'revcym'});
SP('bass','PSB-ACIDBP-V25','Psy Bandpass Acid','PSYTRANCE',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:5,cutoff:800,res:17,fType:'bandpass',gate:.3,dec:.11,sus:.22,fenv:11,fdec:.07,poly:2});
SP('bass','TEB-ACIDBP-V25','Techno Bandpass Acid','TECHNO',{gen:'v25',wave1:'sawtooth',wave2:'square',cutoff:600,res:19,fType:'bandpass',gate:.22,dec:.09,sus:.18,fenv:13,fdec:.05,poly:2});
SP('bass','HTB-ACIDBP-V25','Hi-Tech Bandpass Neuro','HI-TECH',{gen:'v25',wave1:'sawtooth',wave2:'sawtooth',detune:12,cutoff:1400,res:20,fType:'bandpass',gate:.2,dec:.08,sus:.15,fenv:14,fdec:.04,lfoRate:8,lfoDepth:.2,lfoDest:'cutoff',poly:2});
SP('bass','DRB-ACIDBP-V25','Dark Bandpass Screech','DARK-PSY',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:6,cutoff:1200,res:18,fType:'bandpass',gate:.32,dec:.13,sus:.25,fenv:12,fdec:.06,poly:2});
SP('bass','TRB-ACIDBP-V25','Trance Bandpass Acid','TRANCE',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:4,cutoff:900,res:15,fType:'bandpass',gate:.28,dec:.12,sus:.25,fenv:10,fdec:.09,poly:2});
SP('bass','PRB-ACIDBP-V25','Prog Bandpass Movement','PROGRESSIVE',{gen:'v25',wave1:'sawtooth',wave2:'triangle',cutoff:500,res:12,fType:'bandpass',gate:.5,dec:.2,sus:.4,fenv:6,fdec:.16,lfoRate:2.5,lfoDepth:.12,lfoDest:'cutoff',poly:2});
SP('pad','TR-PAD-WIDESAW','Trance Wide Supersaw Pad','TRANCE',{gen:'v25',wave1:'sawtooth',wave2:'sawtooth',detune:28,cutoff:2600,res:4,atk:1.2,dec:2.6,sus:.85,rel:2.6,lfoRate:.35,lfoDepth:.18,lfoDest:'cutoff'});
SP('pad','TE-PAD-RAVEHAZE','Techno Rave Haze Pad','TECHNO',{gen:'v25',wave1:'sawtooth',wave2:'square',detune:26,cutoff:1600,res:7,atk:1.5,dec:2.8,sus:.82,rel:2.4,lfoRate:.3,lfoDepth:.22,lfoDest:'cutoff'});
SP('pad','PS-PAD-MORNINGWIDE','Psy Morning Wide Pad','PSYTRANCE',{gen:'v25',wave1:'sawtooth',wave2:'triangle',oct2:1,detune:30,cutoff:3400,res:5,atk:1.6,dec:3,sus:.85,rel:2.8,lfoRate:.3,lfoDepth:.2,lfoDest:'cutoff'});
SP('pad','GO-PAD-PHRYGLOW','Goa Phrygian Glow Pad','GOA',{gen:'v25',wave1:'sawtooth',wave2:'sawtooth',detune:24,cutoff:2200,res:5,atk:1.8,dec:3,sus:.86,rel:2.5,lfoRate:.45,lfoDepth:.24,lfoDest:'cutoff'});
/* ── v0.12.0 P2: layered kits — full drum-row + role assignments per genre
   (the composer maps roles {kick,snare,hat,perc,bass,lead,pad,arp,fx} →
   preset ids; Phase 4 swaps COMPOSER_STYLES over to these) ── */
/* v0.13.0 P4: bass/lead/pad/arp roles ride gen:'v13' presets (kick/snare/hat/perc
   sacred-consistent from v0.12.0 — the drum rows never move in a patch run) */
const KITS={
'PSYTRANCE':{kick:'PS-KICK-TIGHT',snare:'PS-SNARE2-CRACK',hat:'PS-HAT2-TICK',perc:'PS-CONGA-LOW',bass:'PS-BASS-ROLL',lead:'PS-LEAD-SQUELCH',pad:'PS-PAD-PSYCH',arp:'PS-ARP-ACID',fx:'FX-PS-RISE'},
'DARK-PSY':{kick:'DR-KICK-HAMMER',snare:'DR-SNARE-WHIP',hat:'DR-HAT-NEEDLE',perc:'DR-CONGA-GRAVE',bass:'DB-SCREECH-V13',lead:'DB-RAZOR-V13',pad:'DP-BLACK-V13',arp:'DA-ARP-V13',fx:'FX-PS-RISE'},
'GOA':{kick:'GO-KICK-GLOW',snare:'GO-SNARE-RING',hat:'GO-HAT-SILVER',perc:'GO-CONGA-RITUAL',bass:'GO-BASS-SPIRAL',lead:'GO-LEAD-CRYSTAL',pad:'GO-PAD-SUNRISE',arp:'GO-ARP-LADDER',fx:'FX-PS-RISE'},
'FULL-ON':{kick:'FO-KICK-DRIVE',snare:'FO-SNARE-SNAP',hat:'FO-HAT-SPARK',perc:'FO-CONGA-PUSH',bass:'FB-ROLL-V13',lead:'FL-ANTHEM-V13',pad:'FP-WARM-V13',arp:'FA-ARP-V13',fx:'FX-PS-RISE'},
'TECHNO':{kick:'TE-KICK2-CLUB',snare:'TE-SNARE2-RAW',hat:'TE-HAT2-CHATTER',perc:'TE-CONGA-WAREHOUSE',bass:'TE-BASS-RUMBLE',lead:'TE-LEAD-ACID',pad:'TE-PAD-DARK',arp:'TE-ARP-HYPNO',fx:'FX-TE-RISE'},
'TRANCE':{kick:'TR-KICK2-UPIFT',snare:'TR-CLAP2-WIDE',hat:'TR-HAT2-GLASS',perc:'TR-CONGA-ISLE',bass:'TR-BASS-OFFBEAT',lead:'TR-LEAD-SAW',pad:'TR-PAD-ATMO',arp:'TR-ARP-ROLL',fx:'FX-TR-IMPACT'},
'PROGRESSIVE':{kick:'PR-KICK2-SILK',snare:'PR-SNARE2-BRUSH',hat:'PR-HAT2-MIST',perc:'PR-CONGA-EARTH',bass:'PB-DEEP-V13',lead:'PBL-SOFT-V13',pad:'PP-DEEP-V13',arp:'PA-ARP-V13',fx:'FX-TE-RISE'},
'HI-TECH':{kick:'HT-KICK-PULSE',snare:'HT-SNARE-RAZOR',hat:'HT-HAT-BLITZ',perc:'HT-CONGA-CIRCUIT',bass:'HB-GLITCH-V13',lead:'HB-CHROME-V13',pad:'HP-METAL-V13',arp:'HA-ARP-V13',fx:'FX-TE-RISE'},
/* v0.19.0: FOREST's OWN kit (rode DARK-PSY since v0.7.0) — every role native */
'FOREST':{kick:'FS-KICK-ROOT',snare:'FS-SNARE-TWIG',hat:'FS-HAT-FERN',perc:'FS-CONGA-ROOT',bass:'FS-BASS-LICHEN',lead:'FS-LEAD-BARK',pad:'FS-PAD-MOSS',arp:'FS-ARP-BRANCH',fx:'FX-FS-RISE'},
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
