/**
 * Ethereal Blue Loop
 * * コンセプト:
 * 複数の「光の束」が、目に見えない磁場（ノイズフィールド）に沿って
 * 有機的にうねりながら回転する様子をシミュレーションする。
 */

let t = 0; // タイムカウンタ
let wavePhase = 0;      // 波の位相（累積で繋がる・マウス離しても飛ばない）
let noiseTime = 0;      // ノイズの時間（累積で繋がる・マウス離しても形が続く）
let effectiveColorHue = 212;  // 現在のベース色相（押下中は赤へ・離すと青へシームレスに）
let svgRaw = null;      // SVG ファイルのテキスト（行配列）
let basePoints = [];    // SVG アウトラインの頂点リスト（キャンバス中心基準）

// ccapture.js によるレコーディング
let capturer;           // CCapture インスタンス
let cnv;                // createCanvas の戻り値（capturer.capture に渡す用）
let isRecording = false; // 録画中フラグ

// パラメータ設定（ここをいじると表情が劇的に変わります）
const config = {
  numLines: 100,          // 線の本数（多いほど繊細で重くなる）
  noiseScale: 0.075,       // 歪みの強さ（ノイズ空間上のスケール）
  //noiseFreq: 0,     // ノイズの細かさ（※今は未使用）
  speed: 0.01,           // 全体の変化速度
  //baseRadius: 220,       // 基本の円の大きさ（“サイズ感”の基準）
  noiseRadiusRange: 125,   // ノイズで半径が変動してよい最大幅（±ピクセル）
  outlineThickness: 150,    // 輪郭の太さ（ピクセル）※各線をこの幅で内〜外に並べて帯にする
  waveAmp: 25,            // サイン波による細かい揺れの強さ
  waveFreqAngle: 6,      // サイン波の角度方向の周波数
  waveFreqTime: 3,       // サイン波の時間方向の周波数
  colorHue: 212,         // ベースの色相（離してるときの青系）
  colorHuePressed: 50,    // クリック中の目標色相（0=赤系）
  rotationSpeed: 0.0000,  // 全体の回転速度
  noiseTimeScale: 0.25,   // ノイズによる揺れの時間スケール（小さいほどゆっくり）

  // マウスで形を変える（ゆったり広い範囲）
  mouseInfluence: 50,       // マウスに引っ張られる強さ（控えめに）
  mouseRadius: 200,       // 影響を受ける半径（大きいほど広範囲に）
  mouseFalloff: 1.5         // 距離による減衰のなだらかさ（2=ゆったり、大きいほど中心付近だけ）

  // 外側に広がる線の帳尻合わせ（progress=1のときの全体スケール、1より小さくすると縮小）
  ,progressSizeScale: 0.85
};

// SVG 読み込み（テキストとして）
function preload() {
  // プロジェクト直下に置いた logo.svg を読み込む
  svgRaw = loadStrings('logo_fix2.svg');
}

// SVG のアウトラインをサンプリングして、キャンバス中心を原点とした座標に変換
function prepareBasePoints() {
  if (!svgRaw) return;

  // loadStrings の結果（行配列）を 1 本の文字列に
  let svgText = svgRaw.join('\n');

  // ブラウザの DOMParser で SVG をパース
  let parser = new DOMParser();
  let doc = parser.parseFromString(svgText, 'image/svg+xml');

  // 最初の <path> 要素（単一パス想定）
  let pathEl = doc.querySelector('path');
  if (!pathEl) return;

  // 一時的な <path> 要素を DOM に追加して、ジオメトリ API を使う
  let tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tempPath.setAttribute('d', pathEl.getAttribute('d'));
  tempPath.setAttribute('fill', 'none');
  tempPath.setAttribute('stroke', 'none');
  tempPath.style.position = 'absolute';
  tempPath.style.left = '-10000px'; // 画面外に追い出す
  document.body.appendChild(tempPath);

  let totalLen = tempPath.getTotalLength();
  if (!isFinite(totalLen) || totalLen <= 0) {
    document.body.removeChild(tempPath);
    return;
  }

  // サンプリングする点の数（多いほど細かいアウトラインになる）
  let sampleCount = 500;

  // まずは全点を取得
  let rawPoints = [];
  for (let i = 0; i < sampleCount; i++) {
    let p = tempPath.getPointAtLength((totalLen * i) / sampleCount);
    rawPoints.push(createVector(p.x, p.y));
  }

  // 一時パスを DOM から削除
  document.body.removeChild(tempPath);

  if (rawPoints.length === 0) return;

  // 重心を求める
  let cx = 0;
  let cy = 0;
  for (let v of rawPoints) {
    cx += v.x;
    cy += v.y;
  }
  cx /= rawPoints.length;
  cy /= rawPoints.length;

  // キャンバス中央を原点にした座標へ変換して保存
  basePoints = [];
  for (let v of rawPoints) {
    basePoints.push(createVector(v.x - cx, v.y - cy));
  }
}

function setup() {
  cnv = createCanvas(windowWidth, windowHeight);
  
  // 色空間をHSB（色相, 彩度, 明度, 透明度）に指定
  // 透明度を0~1の範囲で細かく制御したいため
  colorMode(HSB, 360, 100, 100, 1);
  
  // SVG アウトラインを準備
  prepareBasePoints();

  // ccapture.js: PNG連番（tar形式）用に初期化
  capturer = new CCapture({
    format: 'png',
    framerate: 30,
    name: 'my_animation'
  });

  // 背景を一度だけ描画（軌跡を残さない場合はdraw内で呼ぶ）
  background(0, 0, 100); // HSB: 白
}

// ウィンドウリサイズ時にキャンバスを合わせる
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {

  background(0, 0, 100); // HSB: 白（残像用に毎フレーム重ねる）

  translate(width / 2, height / 2); // 画面中央を原点に
  rotate(frameCount * config.rotationSpeed); // 全体をゆっくり回転

  // ウィンドウサイズに合わせてオブジェクトをレスポンシブにスケール（基準 800px）
  let responsiveScale = min(width, height) / 800;
  scale(responsiveScale);

  // progress に応じて全体を縮小（外径がノイズで広がる分を帳尻合わせ）
  let progress = constrain(t * 1, 0, 1);
  let scaleFactor = 1 - progress * (1 - config.progressSizeScale);
  scale(scaleFactor);

  // マウス位置を「回転後のローカル座標」に変換（形と同じ空間で引き寄せ計算するため）
  let mxScreen = mouseX - width / 2;
  let myScreen = mouseY - height / 2;
  let rot = -frameCount * config.rotationSpeed;
  let mx = mxScreen * cos(rot) - myScreen * sin(rot);
  let my = mxScreen * sin(rot) + myScreen * cos(rot);

  // マウス押し込み中だけ揺れをゆっくりに（離すと元のスピードに戻る）
  let waveFreqTimeNow = mouseIsPressed ? 0 : config.waveFreqTime;
  wavePhase += waveFreqTimeNow * config.speed; // 位相を累積→離しても形が繋がる

  // マウス押し込み中だけノイズの時間スケールを大きく（ノイズの変化が速くなる）
  let noiseTimeScaleNow = mouseIsPressed ? 0.5 : config.noiseTimeScale;
  noiseTime += noiseTimeScaleNow * config.speed; // 累積→離しても形の続きから再生

  // クリック中は青→赤へ、離すとその続きから青へシームレスに
  let targetColorHue = mouseIsPressed ? config.colorHuePressed : config.colorHue;
  effectiveColorHue = lerp(effectiveColorHue, targetColorHue, 0.05);

  // 複数の「光の束」を描画するループ
  for (let i = 0; i < config.numLines; i++) {
    
    // 各線ごとの固有オフセット（これがないと全部同じ線になってしまう）
    let indexOffset = i * 0.01;

    // 輪郭の太さ：各線を outlineThickness の帯の内側〜外側に並べる（ノイズとは別）
    let baseOffset = map(i, 0, config.numLines - 1, -config.outlineThickness / 2, config.outlineThickness / 2);
    
    // 線の色設定（effectiveColorHue = 青系⇔赤系をシームレスに）
    let h = effectiveColorHue + sin(t + i * 0.1) * 10; 
    let alpha = map(sin(t + i), -1, 1, 0.6, 0.8); 
    
    noFill();
    stroke(h, 100, 90, alpha);
    strokeWeight(1.5); // ウィンドウサイズに合わせて線の太さもスケール

    // 1本の線（ループ形状）を描く
    beginShape();

    if (basePoints.length > 0) {
      // -------------------------------
      // SVG アウトラインベース
      // -------------------------------
      let cnt = basePoints.length;
      // k を 0..cnt まで回して、最後の頂点は
      // 「位置＝最初の点」「ノイズ角 = 2π」にすることで
      // 形状とノイズの両方をシームレスにループさせる
      for (let k = 0; k <= cnt; k++) {
        let base = basePoints[k % cnt];

        // 角度パラメータ（ノイズ空間サンプリング用）
        // 0 → 2π まできっちり一周させる
        let angle = map(k, 0, cnt, 0, TWO_PI);

        // ノイズ空間の円形サンプリング
        let xoff = map(cos(angle), -1, 1, 0, config.noiseScale);
        let yoff = map(sin(angle), -1, 1, 0, config.noiseScale);

        // ノイズ値を取得
        let n = noise(xoff + indexOffset, yoff + indexOffset, noiseTime);

        // 時間経過に応じて「どれだけ崩すか」の係数（draw内で計算した progress を利用）

        // 中心方向のベクトル
        let dir = base.copy();
        if (dir.mag() !== 0) {
          dir.normalize();
        }

        // SVG のアウトラインから内外方向へオフセットさせる長さ
        // baseOffset = 輪郭の太さの帯、その上にノイズ・波の揺れを乗せる
        let noiseWave =
          map(n, 0, 1, -config.noiseRadiusRange * 0.5, config.noiseRadiusRange * 1) * progress +
          sin(angle * config.waveFreqAngle + wavePhase) * config.waveAmp * progress;
        let offsetLen = baseOffset + noiseWave;

        let x = base.x + dir.x * offsetLen;
        let y = base.y + dir.y * offsetLen;

        // マウスに引っ張る（画面ピクセルと頂点を同じスケールで比較）
        let scaleToScreen = responsiveScale * scaleFactor;
        let xOnScreen = x * scaleToScreen;
        let yOnScreen = y * scaleToScreen;
        let dx = mx - xOnScreen;
        let dy = my - yOnScreen;
        let distFromMouse = sqrt(dx * dx + dy * dy) + 0.001;
        if (distFromMouse < config.mouseRadius) {
          let normalizedDist = distFromMouse / config.mouseRadius; // 0=マウス直下, 1=半径の端
          let strength = pow(1 - normalizedDist, config.mouseFalloff); // ゆったりした減衰
          let pull = (config.mouseInfluence / config.mouseRadius) * strength;
          x += (dx * pull) / scaleToScreen;
          y += (dy * pull) / scaleToScreen;
        }

        vertex(x, y);
      }
    // } else {
    //   // -------------------------------
    //   // フォールバック：従来どおりの円ベース
    //   // -------------------------------
    //   // 円周上を細かく刻んで頂点を打つ
    //   for (let angle = 0; angle < TWO_PI; angle += 0.01) {
    //     // ノイズ空間の円形サンプリング
    //     let xoff = map(cos(angle), -1, 1, 0, config.noiseScale);
    //     let yoff = map(sin(angle), -1, 1, 0, config.noiseScale);

    //     // ノイズ値を取得
    //     let n = noise(xoff + indexOffset, yoff + indexOffset, t * config.noiseTimeScale);

    //     // 時間経過に応じて「どれだけ崩すか」の係数を決める
    //     let progress = constrain(t * 0.5, 0, 1);

    //     // 半径の計算
    //     let r = config.baseRadius
    //       + map(n, 0, 1, -config.noiseRadiusRange, config.noiseRadiusRange) * progress
    //       + sin(angle * config.waveFreqAngle + t * config.waveFreqTime) * config.waveAmp * progress;

    //     // 極座標から直交座標へ変換
    //     let x = r * cos(angle);
    //     let y = r * sin(angle);

    //     vertex(x, y);
    //   }
    }

    // 形を閉じる
    endShape(CLOSE);
  }

  // 時間を進める
  t += config.speed;

  // ccapture.js: 録画中はキャンバスをキャプチャ
  if (isRecording) {
    capturer.capture(cnv.canvas);
  }
}

// Sキーでレコーディング開始/停止（PNG連番 → .tar でダウンロード）
function keyPressed() {
  if (key === 's' || key === 'S') {
    isRecording = !isRecording;
    if (isRecording) {
      capturer.start();
      console.log('[CCapture] レコーディングを開始しました（30fps, PNG → .tar）');
    } else {
      capturer.stop();
      capturer.save();
      console.log('[CCapture] レコーディングを停止し、my_animation.tar をダウンロードしました。');
    }
    return false; // デフォルトのキー動作を防ぐ
  }
}