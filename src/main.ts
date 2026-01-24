import {
  Application,
  Assets,
  Container,
  Sprite,
  Texture,
  Rectangle,
  Point,
  FederatedPointerEvent,
  Graphics,
  TextStyle,
  Text,
} from "pixi.js";

class Fish {
  public container: Container;
  private parent: Container;
  private head!: Sprite;
  private alignedWith: Fish | null = null;
  private pointerId: number | null = null;
  private dragging = false;
  private axis = { x: 0, y: 0 }; // richtungsvektor der Linie auf der sich Fish bewegen kann, computed once in create
  public bodyCount: number = 0; // Länge des Fisches kann jeden Wert annehmen, allerdings werden nur ganze Körpersegmente dargestellt
  private locVec = { x: 0, y: 0 }; // Stützvektor der Linie auf der sich Fisch bewegen kann, computed once in create
  private pointerOffset = 0; // Jedes Mal berechnet, wenn Drag gestartet wird, damit weiß wo cursor relativ zu (oder: auf) Fisch ist

  // bound handlers so we can add/remove listeners cleanly
  private startDragBound = (e: FederatedPointerEvent) => this.startDrag(e);
  private doDragBound = (e: FederatedPointerEvent) => this.doDrag(e);
  private endDragBound = (e: FederatedPointerEvent) => this.endDrag(e);
  private splitBound = (e: FederatedPointerEvent) => this.split(e);

  private constructor(parent: Container, container: Container) {
    this.parent = parent;
    this.container = container;
  }

  // rotationas rotation vec exposed as inherent fish parameter
  // get rotationVec(): { x: number; y: number } {
  //   return this.axis;
  // }
  get rotation(): number {
    return Math.atan2(this.axis.y, this.axis.x);
  }

  static async create(
    parent: Container,
    bodyCount: number,
    scale = 1,
    rotation = 0,
    initialPos: { x: number; y: number },
  ): Promise<Fish | null> {
    const fishTex = await Assets.loadBundle("fish");

    // don't create fish with no body segments
    if (bodyCount < 1) {
      return null;
    }

    const container = new Container();

    // set initial rotation and position BEFORE computing axis/locVec
    container.rotation = rotation + Math.PI; // match fish direction
    container.position.set(initialPos.x, initialPos.y);

    // display debug lines (optional)
    // container.addChild(
    //   new Graphics()
    //     .moveTo(-10000, 0)
    //     .lineTo(10000, 0)
    //     .stroke({ width: 5, color: 0xff0000 }),
    // );

    // horizontal cursor for assembling segments
    let currentSegmentPositon = 0;

    // Helper to create a left-anchored sprite and add to container
    const addSegment = (tex: Texture) => {
      const s = new Sprite(tex);
      s.anchor.set(0, 0.5); // left edge anchored, vertically centered
      s.scale.set(scale);
      s.position.set(currentSegmentPositon, 0);
      container.addChild(s);
      currentSegmentPositon += s.width;
      return s;
    };

    const head = addSegment(fishTex.head);
    // TODO account for head rotation, damit nicht auf dem Kopf stehtf

    for (let i = 0; i < Math.max(0, Math.floor(bodyCount)); i++)
      addSegment(fishTex.body);
    addSegment(fishTex.tail);

    // TODO add animation to make the fish look more realistic

    // configure hitArea and interactivity (must be done before enabling events)
    const bounds = container.getLocalBounds();

    container.hitArea = new Rectangle(
      0,
      -bounds.height / 2,
      currentSegmentPositon,
      bounds.height,
    );
    container.eventMode = "dynamic";
    container.cursor = "grab";
    container.interactive = true;

    const fish = new Fish(parent, container);

    // remember head sprite (first child) for alignment checks
    fish.head = head;
    // remember body count
    fish.bodyCount = bodyCount;

    // compute axis and locVec once (based on rotation and current position)
    const ang = rotation;
    fish.axis.x = Number(Math.cos(ang).toFixed(15));
    fish.axis.y = Number(Math.sin(ang).toFixed(15));
    const pos = container.position.clone();
    fish.locVec.x = pos.x;
    fish.locVec.y = pos.y;

    // add everything to parent container
    parent.addChild(container);

    // attach federated events (no DOM globals)
    container.on("pointertap", fish.splitBound);
    container.on("pointerdown", fish.startDragBound);
    parent.eventMode = "dynamic";
    parent.on("globalpointermove", fish.doDragBound);
    parent.on("pointerup", fish.endDragBound);
    parent.on("pointerupoutside", fish.endDragBound);

    Fish.instances.push(fish);

    return fish;
  }

  static instances: Fish[] = [];

  // cleanup listeners and remove from stage

  destroy(): void {
    this.container.off("pointerdown", this.startDragBound);
    this.parent.off("globalpointermove", this.doDragBound);
    this.parent.off("pointerup", this.endDragBound);
    this.parent.off("pointerupoutside", this.endDragBound);
    if (this.container.parent)
      this.container.parent.removeChild(this.container);
  }

  private startDrag(e: FederatedPointerEvent): void {
    this.pointerId = e.pointerId;

    const pointerPos = new Point(e.globalX, e.globalY);

    const fishPos = this.container.position;
    // offset along axis of fish and pointer
    // assuming point is for sure on axis
    const fishProj =
      this.axis.x != 0
        ? (fishPos.x - this.locVec.x) / this.axis.x
        : (fishPos.y - this.locVec.y) / this.axis.y;
    // project point onto fish axis
    const pointerProj =
      (this.axis.x * (pointerPos.x - this.locVec.x) +
        this.axis.y * (pointerPos.y - this.locVec.y)) /
      (this.axis.x ** 2 + this.axis.y ** 2);
    console.log("startDrag: fishProj, pointerProj", fishProj, pointerProj);
    // preserve offset so the fish doesn't jump on click
    this.pointerOffset = fishProj - pointerProj;

    this.dragging = true;
    this.container.cursor = "grabbing";
    // console.log(this.container.position);
    e.stopPropagation?.();
  }

  private doDrag(e: FederatedPointerEvent): void {
    console.log(
      "doDrag: dragging, eventPointerId, currentPointerId",
      this.dragging,
      e.pointerId,
      this.pointerId,
    );
    if (!this.dragging) return;
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;

    const pointerPos = new Point(e.globalX, e.globalY);

    const pointerProj =
      (this.axis.x * (pointerPos.x - this.locVec.x) +
        this.axis.y * (pointerPos.y - this.locVec.y)) /
      (this.axis.x ** 2 + this.axis.y ** 2);
    const newProj = pointerProj + this.pointerOffset;

    // TODO restrain center position, moving on line, to be in the canvas, to avoid bugs

    const newPosX = this.axis.x * newProj + this.locVec.x;
    const newPosY = this.axis.y * newProj + this.locVec.y;

    this.container.position.set(newPosX, newPosY);

    // check head alignment with other fishes (approx x or y within threshold)
    try {
      const thresh = 24;
      const head = this.head;
      const hb = head.getBounds();
      const hx = hb.x + hb.width / 2;
      const hy = hb.y + hb.height / 2;

      this.alignedWith = null; // reset to look if there is still alignment
      for (const other of Fish.instances) {
        if (other === this) continue;
        const oh = other.head;
        const ob = oh.getBounds();
        const ox = ob.x + ob.width / 2;
        const oy = ob.y + ob.height / 2;
        const dx = Math.abs(hx - ox);
        const dy = Math.abs(hy - oy);

        if (dx <= thresh && dy <= thresh) {
          // quick visual - squash head vertically briefly
          head.scale.y = 0.25;
          oh.scale.y = 0.25;
          setTimeout(() => {
            head.scale.y = 1;
            oh.scale.y = 1;
          }, 180);

          this.alignedWith = other;
        }
      }
    } catch {
      // defensive: don't let alignment checks break dragging
      // (e.g., if textures not loaded yet)
    }
  }

  private endDrag(e: FederatedPointerEvent): void {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
    this.container.cursor = "grab";
    if (this.alignedWith) {
      // TODO add animation for merging
      // merge these two fishes by creating a new one with them added like vectors
      const newVec = {
        x:
          this.bodyCount * this.axis.x +
          this.alignedWith.bodyCount * this.alignedWith.axis.x,
        y:
          this.bodyCount * this.axis.y +
          this.alignedWith.bodyCount * this.alignedWith.axis.y,
      };
      const len = Math.hypot(newVec.x, newVec.y);

      const newRotation = Math.atan2(newVec.y, newVec.x);
      const newBodyCount = Math.abs(len);
      // intersection of movement lines to position new fish
      // compute where two lines intersect, given location vector and direction vectors
      let newPos = { x: 0, y: 0 };
      if (
        // take abs value to catch both parallel and anti-parallel lines
        Math.abs(this.axis.x) === Math.abs(this.alignedWith.axis.x) &&
        Math.abs(this.axis.y) === Math.abs(this.alignedWith.axis.y)
      ) {
        // case parallel lines: just average positions
        newPos = {
          x:
            (this.container.position.x +
              this.alignedWith.container.position.x) /
            2,
          y:
            (this.container.position.y +
              this.alignedWith.container.position.y) /
            2,
        };
      } else {
        // general case
        const intersectCoeff =
          (this.axis.x * (this.locVec.y - this.alignedWith.locVec.y) -
            this.axis.y * (this.locVec.x - this.alignedWith.locVec.x)) /
          (this.alignedWith.axis.y * this.axis.x -
            this.alignedWith.axis.x * this.axis.y);
        newPos = {
          x:
            this.alignedWith.locVec.x +
            this.alignedWith.axis.x * intersectCoeff,
          y:
            this.alignedWith.locVec.y +
            this.alignedWith.axis.y * intersectCoeff,
        };
      }

      console.log(
        "endDrag: merging fishes, newVec, newRotation, newBodyCount, newPos",
        newVec,
        newRotation,
        newBodyCount,
        newPos,
      );

      // create new fish
      Fish.create(this.parent, newBodyCount, 0.5, newRotation, newPos);

      // destroy the two old fishes
      this.destroy();
      this.alignedWith.destroy();
      Fish.instances = Fish.instances.filter(
        (f) => f !== this && f !== this.alignedWith,
      );
    }
  }

  private split(e: FederatedPointerEvent): void {
    console.log("split: fish instance", this);
    // TODO add animation for splitting

    if (e.detail > 1) {
      // split into two fishes, aligned with x and y axis respectively
      const pos = this.container.position.clone();
      console.log("split: axis, bodyCount", this.axis, this.bodyCount);

      // add arrows to stage to show positive x and y axis
      const arrowX = new Graphics()
        .moveTo(0, 0)
        .lineTo(50, 0)
        .lineTo(40, -10)
        .moveTo(50, 0)
        .lineTo(40, 10)
        .stroke({ width: 4, color: 0xff0000 });
      arrowX.position.set(50, 50);
      this.parent.addChild(arrowX);

      const arrowY = new Graphics()
        .moveTo(0, 0)
        .lineTo(0, 50)
        .lineTo(-10, 40)
        .moveTo(0, 50)
        .lineTo(10, 40)
        .stroke({ width: 4, color: 0x0000ff });
      arrowY.position.set(100, 50);
      this.parent.addChild(arrowY);
      // aligned with x axis
      let xrotation = 0;
      if (this.axis.x < 0) xrotation = Math.PI;
      Fish.create(
        this.parent,
        Math.abs(this.bodyCount * this.axis.x),
        0.6,
        xrotation,
        { x: pos.x, y: pos.y },
      );

      // aligned with y axis
      let yrotation = Math.PI / 2;
      if (this.axis.y < 0) yrotation = -Math.PI / 2;
      Fish.create(
        this.parent,
        Math.abs(this.bodyCount * this.axis.y),
        0.6,
        yrotation,
        { x: pos.x, y: pos.y },
      );

      this.destroy();
      Fish.instances = Fish.instances.filter((f) => f !== this);
    }
  }
}

(async () => {
  const app = new Application();
  await app.init({
    background: 0x00000,
    resizeTo: window,
  });

  document.getElementById("pixi-container")!.appendChild(app.canvas);
  await Assets.init({ manifest: "assets/manifest.json" });

  let textProgress = 0; // tracks every step in the storyline
  let currentLevelData: {
    levelNumber: number;
    initFishs: { x: number; y: number; rotation: number; length: number }[];
    fishConditions: {
      xMin: number;
      xMax: number;
      yMin: number;
      yMax: number;
      rotationMin: number;
      rotationMax: number;
      lengthMin: number;
      lengthMax: number;
    }[];
    maxText: number;
    newtonText: { "text-en": string[] };
  };

  function nextNewtonText() {
    textProgress += 1;
    if (textProgress > currentLevelData.maxText)
      textProgress = currentLevelData.maxText; // check bounds, if some1 spams the button
    // or do some other checking to not show text until condition is met
    console.log("nextNewtonText: current textProgress", textProgress);
    newtonBubbleText.text =
      currentLevelData.newtonText["text-en"][textProgress];
  }
  function precedingNewtonText() {
    // mainly to let the user read the last text again
    textProgress -= 1;
    if (textProgress < 0) textProgress = 0; // check bounds, if some1 spams the button
    console.log("revert to last Text: current textProgress", textProgress);
    newtonBubbleText.text =
      currentLevelData.newtonText["text-en"][textProgress];
  }

  // add background stars
  const starTexture = await Assets.load("https://pixijs.com/assets/star.png");

  const starAmount = 1000;
  const stars = []; // vlt später noc leichtes funkeln

  for (let i = 0; i < starAmount; i++) {
    const star = new Sprite(starTexture);

    star.anchor = 0.5;
    star.x = Math.random() * window.innerWidth;
    star.y = Math.random() * window.innerHeight;
    star.scale.set(Math.random() / 15); // constant factor, maybe adjust for texture size
    app.stage.addChild(star);
    stars.push(star);
  }

  // create container to later put fishes in, so that tey are behind newton
  const fishContainer = new Container();
  app.stage.addChild(fishContainer);

  // add newton to screen
  const newtonAssets = await Assets.loadBundle("newton");
  const newton = new Container();
  newton.position.set(0, window.innerHeight);
  // newton.position.set(window.innerWidth, window.innerHeight);

  app.stage.addChild(newton);

  const newtonBody = new Sprite(newtonAssets.body);

  newtonBody.anchor.set(0, 1);
  newtonBody.scale.set((0.2 * window.innerWidth) / newtonBody.width);
  // position graphic in the lower left edge of window
  // newtonBody.position.set(100, window.innerHeight - 100);
  newtonBody.eventMode = "none";
  newton.addChild(newtonBody);

  // add speech bubble to Newton
  const newtonBubble = new Container();
  newtonBubble.position.set(
    newtonBody.width - newtonBody.width * 0.25,
    -newtonBody.height,
  );
  newtonBubble.eventMode = "none";
  newton.addChild(newtonBubble);

  const newtonBubbleGraphic = new Sprite(newtonAssets.bubble);
  newtonBubbleGraphic.scale.set(
    (0.16 * window.innerWidth) / newtonBubbleGraphic.width,
  );
  newtonBubbleGraphic.anchor.set(0, 0.5);
  newtonBubble.addChild(newtonBubbleGraphic);

  const newtonBubbleText: Text = new Text({
    text: "Hi, I'm Newtonian, but why can you read this?",
    style: new TextStyle({
      align: "center",
      fill: "#000000",
      fontSize: 15,
      fontFamily: "Orbitron, Arial",
      wordWrap: true,
      wordWrapWidth: newtonBubble.width - 100,
      lineHeight: 25,
      dropShadow: true,
      // "Space glow" effect
      dropShadowColor: "#7c2abe",
      dropShadowBlur: 4,
    }),
  });
  newtonBubbleText.anchor.set(0.5);
  newtonBubbleText.x = newtonBubble.width / 2;

  newtonBubble.addChild(newtonBubbleText);

  const newtonNextButton = new Sprite(newtonAssets.next);
  newtonNextButton.anchor.set(1, 1);
  newtonNextButton.scale.set(
    (0.05 * window.innerWidth) / newtonNextButton.width,
  );
  newtonNextButton.position.set(newton.width - 20, 0);
  newtonNextButton.cursor = "pointer";
  newtonNextButton.eventMode = "dynamic";
  newtonNextButton.on("pointerdown", () => nextNewtonText());
  newton.addChild(newtonNextButton);

  const newtonPrevButton = new Sprite(newtonAssets.prev ?? newtonAssets.next);
  newtonPrevButton.anchor.set(0, 1);
  newtonPrevButton.scale.set(
    (0.05 * window.innerWidth) / newtonPrevButton.width,
  );
  newtonPrevButton.scale.x *= -1; // flip horizontally
  newtonPrevButton.position.set(
    newtonNextButton.x - newtonPrevButton.width - 10,
    0,
  );
  newtonPrevButton.cursor = "pointer";
  newtonPrevButton.eventMode = "dynamic";
  newtonPrevButton.on("pointerdown", () => precedingNewtonText());
  newton.addChild(newtonPrevButton);

  // read in level data from json or define here directly
  const levelData = await Assets.load("assets/level-data.json");
  currentLevelData = levelData.level[0];

  // game begins here
  newtonBubbleText.text = currentLevelData.newtonText["text-en"][textProgress]; // textProgress should be 0

  // Fische hinzufügen
  await Fish.create(
    app.stage,
    currentLevelData.initFishs[0].length,
    0.5,
    currentLevelData.initFishs[0].rotation,
    {
      x: currentLevelData.initFishs[0].x,
      y: currentLevelData.initFishs[0].y,
    },
  );
  // check if specififc fish condition is met and then call nextGameStep to advance

  // very ugly, but try to give fish the possibility to check level completion in the future
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    possibleLevelCompletion();
    console.log("Checking level completion...");
  }

  function possibleLevelCompletion(): boolean {
    for (const fishPositioning of currentLevelData.fishConditions) {
      let fishFound = false;
      for (const fish of Fish.instances) {
        const pos = fish.container.position;
        const rot = fish.rotation;
        console.log(
          "Checking fish at pos, rot, bodyCount:",
          pos,
          rot,
          fish.bodyCount,
        );
        if (
          pos.x >= fishPositioning.xMin &&
          pos.x <= fishPositioning.xMax &&
          pos.y >= fishPositioning.yMin &&
          pos.y <= fishPositioning.yMax &&
          rot >= fishPositioning.rotationMin &&
          rot <= fishPositioning.rotationMax &&
          fish.bodyCount >= fishPositioning.lengthMin &&
          fish.bodyCount <= fishPositioning.lengthMax
        ) {
          fishFound = true;
          break;
        }
      }
      if (!fishFound) {
        return false; // if any required fish positioning is not met, level is not complete
      }
    }

    // if we reach here, all required fish positionings are met
    if (currentLevelData.maxText != textProgress) {
      console.log(
        "Level conditions met, but waiting for user to read all texts",
      );
      return false;
    }
    for (const fish of Fish.instances) {
      fish.destroy(); // remove all fishes for next level
    }
    console.log("Level completed, advancing to next task");
    currentLevelData = levelData.level[currentLevelData.levelNumber + 1];
    for (const initFish of currentLevelData.initFishs) {
      Fish.create(app.stage, initFish.length, 0.5, initFish.rotation, {
        x: initFish.x,
        y: initFish.y,
      });
    }
    textProgress = 0;
    newtonBubbleText.text =
      currentLevelData.newtonText["text-en"][textProgress];
    return true;
  }
})();
