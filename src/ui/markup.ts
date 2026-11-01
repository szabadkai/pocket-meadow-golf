// Static DOM for HUD and menus. Icons are inline SVG (no icon fonts or images).

export const ICONS = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="#fff4dc" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="9" r="1.6" fill="#ff8a73"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l6 9h-4v9h-4v-9H6z" fill="#fff4dc" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  driver: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M22 3L12 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="10" cy="24" rx="7" ry="5" fill="#ff8a73" stroke="currentColor" stroke-width="2"/></svg>',
  iron: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M22 3L13 22" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M13 21l-8 2 2 5 9-3z" fill="#cfd6dc" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  wedge: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M22 3L14 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M14 20l-9-2 1 7 10 2z" fill="#ffd86b" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  putter: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20 3v20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="8" y="22" width="16" height="6" rx="2" fill="#9ee6b8" stroke="currentColor" stroke-width="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
};

export const HUD_HTML = `
<canvas id="gl" aria-label="Golf course"></canvas>
<div id="hud" class="hud hidden">
  <header id="topbar" class="topbar">
    <button id="menuBtn" class="iconBtn" aria-label="Pause menu">${ICONS.menu}</button>
    <div class="holeInfo">
      <div class="holeTitle"><span id="hudHole">Hole 1</span> <span id="hudName" class="holeName">First Flight</span></div>
      <div class="holeSub"><span id="hudPar">Par 4</span> · <span id="hudStroke">Stroke 1</span> · <b id="hudTotal">E</b></div>
    </div>
    <div id="wind" class="wind" aria-label="Wind">
      <span id="windArrow" class="windArrow">${ICONS.wind}</span>
      <span class="windTxt"><b id="windSpeed">3</b><small>mph</small></span>
    </div>
  </header>
  <div id="course" class="course">
    <div id="chips" class="chips">
      <span id="chipPin" class="chip">To pin 0y</span>
      <span id="chipLie" class="chip lie">Tee</span>
      <button id="errandChip" class="chip errand" aria-label="This hole's errand"></button>
    </div>
    <div id="shotMods" class="shotMods">
      <button id="itemBtn" class="modBtn hidden" aria-label="Basket item"><span id="itemEmoji">🧺</span><small id="itemLabel">Use</small></button>
      <button id="spinBtn" class="modBtn" aria-label="Spin"><span id="spinIcon">●</span><small id="spinLabel">No spin</small></button>
    </div>
    <div id="stamp" class="stamp hidden"></div>
    <button id="overviewBtn" class="bigBtn overviewBtn" aria-label="Look around the hole">${ICONS.map}<span>Look</span></button>
    <button id="practiceShotBtn" class="practiceShotBtn hidden" aria-label="Review last practice shot">↶ Last shot</button>
    <div id="lookTools" class="lookTools hidden">
      <button id="zoomIn" class="bigBtn round" aria-label="Zoom in">+</button>
      <button id="zoomOut" class="bigBtn round" aria-label="Zoom out">−</button>
    </div>
    <div id="lookHint" class="lookHint hidden">Drag to look · pinch or +/− to zoom · twist to turn</div>
    <aside id="puttingRead" class="puttingRead hidden" aria-label="Pip's green read">
      <div class="puttingReadHead"><b>Pip’s green read</b><span id="puttingPower"></span></div>
      <div class="puttingReadValues"><strong id="puttingSlope"></strong><strong id="puttingBreak"></strong></div>
      <small id="puttingNote">Perfect-strike estimate</small>
    </aside>
    <div id="landLabel" class="landLabel hidden">0y</div>
    <div id="pip" class="speech hidden" role="status" aria-live="polite">
      <div class="pipFace" aria-hidden="true"></div>
      <div class="pipBody"><span id="pipText"></span>
        <div id="pipBtns" class="pipBtns hidden"><button id="pipNext" class="smallBtn">Got it</button><button id="pipSkip" class="smallBtn ghost">Skip tutorial</button></div>
        <div id="pipChoice" class="pipBtns hidden"></div>
      </div>
    </div>
    <div id="toast" class="toast hidden"></div>
    <div id="skipHint" class="skipHint hidden">Tap to skip</div>
  </div>
  <div id="aimbar" class="aimbar">
    <button id="aimLeft" class="nudge" aria-label="Aim left">${ICONS.left}</button>
    <div id="aimStrip" class="aimStrip" aria-label="Drag to aim">
      <div id="aimTicks" class="aimTicks"></div>
      <span class="aimHint">◀ drag to aim ▶</span>
    </div>
    <button id="aimRight" class="nudge" aria-label="Aim right">${ICONS.right}</button>
  </div>
  <div id="controls" class="controls">
    <div id="clubs" class="clubs" role="radiogroup" aria-label="Club">
      <button class="club" data-club="driver" role="radio">${ICONS.driver}<span>Driver</span><small>160</small></button>
      <button class="club" data-club="iron" role="radio">${ICONS.iron}<span>Iron</span><small>115</small></button>
      <button class="club" data-club="wedge" role="radio">${ICONS.wedge}<span>Wedge</span><small>65</small></button>
      <button class="club" data-club="putter" role="radio">${ICONS.putter}<span>Putter</span><small>30</small></button>
    </div>
    <div id="pad" class="pad" aria-label="Swing pad: pull down to set power, release to hit">
      <div class="padMeter"><div id="padFill" class="padFill"></div><div class="padMarks"></div></div>
      <div class="padCenter">
        <div class="padBall"></div>
        <div id="padLabel" class="padLabel">Pull down to swing</div>
      </div>
    </div>
    <div id="meterPad" class="meterPad hidden" aria-label="Hold for power, release, then tap on the mark">
      <div class="meterRow"><b id="meterLabel">Hold for power</b><span id="meterCarry"></span></div>
      <div class="meterBar">
        <div id="meterZone" class="meterZone"></div>
        <div id="meterTicks" class="meterTicks"></div>
        <div id="meterFill" class="meterFill"></div>
        <div id="meterSet" class="meterSet hidden"></div>
        <div id="meterImpact" class="meterImpact"></div>
        <div id="meterCursor" class="meterCursor"></div>
      </div>
      <button id="meterSwing" class="meterSwing" aria-describedby="meterSteps meterLabel">SWING</button>
      <div id="meterSteps" class="meterSteps"><span>HOLD FOR POWER</span><i> → </i><span>RELEASE</span><i> → </i><span>TAP ON THE MARK</span></div>
      <button id="meterCancel" class="meterCancel hidden" aria-label="Cancel swing">${ICONS.close}</button>
    </div>
    <div id="tapPad" class="tapPad hidden">
      <button id="pMinus" class="bigBtn round" aria-label="Less power">−</button>
      <div class="tapMeter"><div id="tapFill" class="tapFill"></div><span id="tapPct">60%</span></div>
      <button id="pPlus" class="bigBtn round" aria-label="More power">+</button>
      <button id="tapSwing" class="bigBtn primary">Swing</button>
    </div>
  </div>
</div>
<div id="flash" class="flash"></div>
<div id="power" class="powerBubble hidden"><b id="powerPct">0%</b><span id="powerCarry">0y</span></div>
<div id="screens">
  <section id="scrTitle" class="screen title hidden">
    <div class="logo">
      <div class="logoSmall">Pocket</div>
      <div class="logoBig">Meadow</div>
      <div class="logoGolf">Golf</div>
    </div>
    <div class="menu">
      <button id="btnContinue" class="bigBtn primary hidden">Continue Round<small id="continueInfo"></small></button>
      <button id="btnPlay" class="bigBtn primary">Play 9 Holes</button>
      <button id="btnPractice" class="bigBtn">Practice</button>
      <button id="btnClub" class="bigBtn">Club &amp; Wardrobe<small id="clubInfo"></small></button>
      <button id="btnSettings" class="bigBtn">Settings</button>
    </div>
    <div id="titleBest" class="titleBest"></div>
  </section>
  <section id="scrPractice" class="screen panel hidden">
    <div class="card">
      <h2><button class="iconBtn back" data-back aria-label="Back">${ICONS.back}</button>Practice</h2>
      <p class="muted">Pick any hole. Review each shot’s path, then retry from the same spot with the same wind. Your round stays saved.</p>
      <div id="practiceGrid" class="holeGrid"></div>
    </div>
  </section>
  <section id="scrBasket" class="screen panel hidden">
    <div class="card pop basketCard">
      <h2>🧺 Picnic basket</h2>
      <p class="muted">Pip packed snacks! Each one bends the rules for a single shot. Keep it as long as you like.</p>
      <p id="basketNote" class="basketNote"></p>
      <div id="basketItems" class="basketItems"></div>
      <button id="basketSkip" class="smallBtn ghost">No thanks</button>
    </div>
  </section>
  <section id="scrClub" class="screen panel hidden">
    <div class="card">
      <h2><button class="iconBtn back" data-back aria-label="Back">${ICONS.back}</button>The Club</h2>
      <div id="clubStars" class="clubStars"></div>
      <h3>Club projects</h3>
      <div id="clubProjects" class="projects"></div>
      <h3>Golfer’s cap</h3>
      <div id="clubCaps" class="swatches"></div>
      <h3>Pip’s scarf</h3>
      <div id="clubScarves" class="swatches"></div>
    </div>
  </section>
  <section id="scrSettings" class="screen panel hidden">
    <div class="card">
      <h2><button class="iconBtn back" data-back aria-label="Back">${ICONS.back}</button>Settings</h2>
      <label class="row"><span>Sound</span><input id="setSfx" type="range" min="0" max="1" step="0.05" /></label>
      <label class="row"><span>Music</span><input id="setMusic" type="range" min="0" max="1" step="0.05" /></label>
      <div class="row"><span>Swing</span><div class="seg" id="setSwing"><button data-v="meter">Hold</button><button data-v="drag">Pull</button><button data-v="tap">Buttons</button></div></div>
      <div class="row"><span>Graphics</span><div class="seg" id="setQuality"><button data-v="auto">Auto</button><button data-v="low">Low</button><button data-v="medium">Med</button><button data-v="high">High</button></div></div>
      <label class="row"><span>Reduce motion</span><input id="setMotion" type="checkbox" class="toggle" /></label>
      <label class="row"><span>Vibration</span><input id="setHaptics" type="checkbox" class="toggle" /></label>
      <div class="row"><button id="setTutorial" class="smallBtn">Replay tutorial</button></div>
      <p id="storageNote" class="muted hidden">This browser isn't letting us save, so progress lasts until you close the tab.</p>
    </div>
  </section>
  <section id="scrPause" class="screen panel hidden">
    <div class="card">
      <h2>Paused</h2>
      <div class="menu">
        <button id="pResume" class="bigBtn primary">Resume</button>
        <button id="pCard" class="bigBtn">Scorecard</button>
        <button id="pSettings" class="bigBtn">Settings</button>
        <button id="pRestart" class="bigBtn">Restart hole</button>
        <button id="pQuit" class="bigBtn">Save &amp; quit to title</button>
      </div>
    </div>
  </section>
  <section id="scrCard" class="screen panel hidden">
    <div class="card">
      <h2><button class="iconBtn back" data-back aria-label="Back">${ICONS.back}</button>Scorecard</h2>
      <div id="cardTable"></div>
    </div>
  </section>
  <section id="scrHole" class="screen holeDone hidden">
    <div class="card pop">
      <div id="holeScoreName" class="scoreName">Par</div>
      <div id="holeScoreSub" class="muted"></div>
      <div id="holeStars" class="holeStars"></div>
      <div id="holeUnlocks" class="holeUnlocks"></div>
      <div id="holeCard"></div>
      <button id="holeReviewShot" class="bigBtn hidden">↶ Review last shot</button>
      <button id="btnNext" class="bigBtn primary">Next hole</button>
    </div>
  </section>
  <section id="scrShot" class="screen panel hidden" role="dialog" aria-modal="true" aria-label="Practice shot review">
    <div class="card shotCard">
      <div class="shotEyebrow">PRACTICE · LEARN YOUR SHOT</div>
      <h2>One more try?</h2>
      <p id="shotSetup" class="muted"></p>
      <div id="shotMap" class="shotMap"></div>
      <div class="shotLegend"><span>○ Start</span><span>━ Actual path</span><span>● Finish</span></div>
      <div id="shotOutcome" class="shotOutcome"></div>
      <div class="shotStats">
        <div><strong id="shotDistance"></strong><small>Distance</small></div>
        <div><strong id="shotCarry"></strong><small>First carry</small></div>
        <div><strong id="shotToPin"></strong><small>Left to pin</small></div>
      </div>
      <p id="shotAccuracy" class="shotAccuracy"></p>
      <p class="shotRetryNote">Retry restores your spot, aim, club, spin and snack. Same wind, no extra stroke.</p>
      <div class="shotActions">
        <button id="shotRetry" class="bigBtn primary">↶ Retry this shot</button>
        <button id="shotContinue" class="bigBtn">Keep playing</button>
      </div>
    </div>
  </section>
  <section id="scrResults" class="screen panel hidden">
    <div class="card">
      <h2>Round complete!</h2>
      <div id="resTotal" class="resTotal"></div>
      <div id="resBest" class="muted"></div>
      <div id="resTable"></div>
      <div class="menu">
        <button id="resAgain" class="bigBtn primary">Play again</button>
        <button id="resTitle" class="bigBtn">Title</button>
      </div>
    </div>
  </section>
  <section id="scrLost" class="screen panel hidden">
    <div class="card"><h2>Repainting the meadow…</h2><p class="muted">The graphics were interrupted. Hang on a moment.</p></div>
  </section>
  <section id="scrRotate" class="screen hidden"></section>
</div>
`;
