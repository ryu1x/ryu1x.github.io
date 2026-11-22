// 出前ダッシュ!! — コースデータのモジュール（2026-11-22 A回・キュー 7-3）
// index.html のモジュール本体から切り出した第1段階。コースの形
// （既定値・スキーマ検証・版の移行・制御点の補間）だけを集めたもので、
// ほかの部分（塔の物理・描画・入力・音・画面）には依存しない。
// 読み込みは <script src="demae-course.js">（ふつうのスクリプト）で、
// file:// でも GitHub Pages でも index.html のモジュール本体より先に
// 読まれる。window.DemaeCourse にまとめて置く（ブラウザでは window、
// node で eval したときは globalThis）。
// node のテスト・sync-course.js・check-course-sync.js は、このファイル
// を直接読んで使う（以前は index.html から関数を抜き出していた）。
// 遊びの数値・物理・しきい値はここにはない（PHYS は index.html 側）。
// 公開するときは index.html と一緒に demae-dash/demae-course.js として
// 出すこと（COURSE-SYNC.md の公開手順を参照）。
(function (root) {
"use strict";

// ---------- コースデータ（JSON。course.json が正本で、index.html には同じ内容を埋め込む） ----------
// 編集は course-editor.html で行い、node sync-course.js で埋め込み直す。
// ?course=local のときだけ、エディタが localStorage に置いた編集中コースを読む（試走用）。
// 読み込みに失敗した場合は course.json と同一の既定値を使う。
// （course.json の写し。正本は course.json。check-course-sync.js が一致を確かめる）
const COURSE_DEFAULT = { goalDist: 5800, checkpoint: 2900, step: 3200, jump: 4600,
  name: "コース初版 v1.1（下り強調・標高16）", version: 3,
  elevation: [{ d: 0, h: 16 }, { d: 1200, h: 14 }, { d: 2600, h: 8 }, { d: 3800, h: 3 }, { d: 4600, h: 0 }, { d: 5800, h: 0 }],
  centerline: [{ d: 0, x: 0 }, { d: 1000, x: 0 }, { d: 1800, x: -2.6 }, { d: 2600, x: 0 }, { d: 3400, x: 2.8 }, { d: 4400, x: 0 }, { d: 5800, x: 0 }],
  obstacles: [
    { x: 1400, lane: 1, halfW: 70, type: "truck" },
    { x: 2100, lane: 2, halfW: 70, type: "cones" },
    { x: 3800, lane: 2, halfW: 62, type: "crates" },
    { x: 5300, lane: 0, halfW: 70, type: "cones", flag: true },
  ] };
// ---------- コースデータのスキーマ検証（2026-11-20 A回・キュー 4-4） ----------
// 埋め込みJSON・localStorage の仮コースは、形がおかしいと読み込み時に
// 壊れたコースで遊べてしまう（profileAt が空の配列で止まる、obstacles が
// 配列でないと map で止まる、障害物の位置が段差と重なると衝撃が二重に
// 入る、など）。validateCourse() はコースの形だけを確かめ、おかしい
// ところを日本語の文言の配列で返す（空なら正しい）。遊びの数値・物理・
// しきい値には触れない。loadCourse()（index.html 側）は検証に通った
// コースだけを使い、通らなかったものは理由を courseErrors に残して
// 次の読み込み元へ落とす（仮コース→埋め込み→既定値の順。従来の読み込み
// の順番は変えない）。この関数は他に依存しない形にしてある。
function validateCourse(c) {
  const errs = [];
  const isNum = v => typeof v === "number" && Number.isFinite(v);
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["コースがオブジェクトではありません"];
  if (c.name !== undefined && typeof c.name !== "string") errs.push("name は文字列にしてください");
  if (!isNum(c.version)) errs.push("version は数値にしてください");
  const gdOk = isNum(c.goalDist) && c.goalDist > 0;
  if (!gdOk) errs.push("goalDist は 0 より大きい数値にしてください");
  // 進行上の目印（鳥居・段差・ジャンプ台）はコースの内側になければならない。
  const marks = [["checkpoint", c.checkpoint], ["step", c.step], ["jump", c.jump]];
  for (const [key, v] of marks) {
    if (!isNum(v)) errs.push(key + " は数値にしてください");
    else if (gdOk && (v <= 0 || v >= c.goalDist)) errs.push(key + " は 0〜goalDist のあいだの数値にしてください（いま " + v + "）");
  }
  // 目印どうしが近すぎると衝撃が重なる（段差とジャンプ台など）。100以上離す。
  for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
    if (isNum(marks[i][1]) && isNum(marks[j][1]) && Math.abs(marks[i][1] - marks[j][1]) < 100) {
      errs.push(marks[i][0] + " と " + marks[j][0] + " が近すぎます（100以上離してください）");
    }
  }
  // 標高・中心線のプロファイル：空でなく、d は 0 から始めて増え続け、
  // ゴールまで届いていなければならない（届かない区間は最後の値で
  // 平らになってしまうため）。
  for (const [key, valKey] of [["elevation", "h"], ["centerline", "x"]]) {
    const pts = c[key];
    if (!Array.isArray(pts) || pts.length === 0) { errs.push(key + " は空でない配列にしてください"); continue; }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p || typeof p !== "object") { errs.push(key + "[" + i + "] がオブジェクトではありません"); continue; }
      if (!isNum(p.d)) errs.push(key + "[" + i + "].d は数値にしてください");
      if (!isNum(p[valKey])) errs.push(key + "[" + i + "]." + valKey + " は数値にしてください");
      // 前の要素が null などオブジェクトでないときは、ここで .d を読むと
      // 投げてしまう（Issue #1）。オブジェクトのときだけ比べる。
      const prev = pts[i - 1];
      if (i > 0 && isNum(p.d) && prev && typeof prev === "object" && isNum(prev.d) && p.d <= prev.d) errs.push(key + " の d が増えていません（[" + i + "] の d=" + p.d + "）");
    }
    // 先頭・末尾の要素が null のときも .d を読むと投げるため、同じく
    // オブジェクトのときだけ見る（null 自体は上のループで弾いてある）。
    const first = pts[0], last = pts[pts.length - 1];
    if (first && typeof first === "object" && isNum(first.d) && first.d !== 0) errs.push(key + " は d=0 から始めてください（いま " + first.d + "）");
    if (gdOk && last && typeof last === "object" && isNum(last.d) && last.d < c.goalDist) errs.push(key + " がゴールまで届いていません（最後の d=" + last.d + "）");
  }
  // 障害物：位置はコースの内側、車線は 0〜2、半幅は正の数、種別は3種の
  // いずれか。目印・他の障害物と近すぎるものも弾く（衝撃の重なり・
  // 避けられない壁になるため）。
  if (!Array.isArray(c.obstacles)) { errs.push("obstacles は配列にしてください"); }
  else {
    const types = ["truck", "cones", "crates"];
    for (let i = 0; i < c.obstacles.length; i++) {
      const o = c.obstacles[i], tag = "obstacles[" + i + "]";
      if (!o || typeof o !== "object") { errs.push(tag + " がオブジェクトではありません"); continue; }
      if (!isNum(o.x)) errs.push(tag + ".x は数値にしてください");
      else if (gdOk && (o.x <= 0 || o.x >= c.goalDist)) errs.push(tag + ".x は 0〜goalDist のあいだの数値にしてください（いま " + o.x + "）");
      if (!Number.isInteger(o.lane) || o.lane < 0 || o.lane > 2) errs.push(tag + ".lane は 0〜2 の整数にしてください（いま " + o.lane + "）");
      if (!isNum(o.halfW) || o.halfW <= 0) errs.push(tag + ".halfW は 0 より大きい数値にしてください（いま " + o.halfW + "）");
      if (types.indexOf(o.type) < 0) errs.push(tag + ".type は truck/cones/crates のいずれかにしてください（いま " + o.type + "）");
      if (o.flag !== undefined && typeof o.flag !== "boolean") errs.push(tag + ".flag は true/false にしてください");
      if (isNum(o.x)) {
        for (const [key, v] of marks) {
          if (isNum(v) && Math.abs(o.x - v) < 100) errs.push(tag + " が " + key + " に近すぎます（100以上離してください）");
        }
        for (let j = 0; j < i; j++) {
          const q = c.obstacles[j];
          if (q && isNum(q.x) && q.lane === o.lane && Math.abs(o.x - q.x) < 100) errs.push(tag + " と obstacles[" + j + "] が同じ車線で近すぎます（100以上離してください）");
        }
      }
    }
  }
  return errs;
}
// ---------- コースJSONの版の管理と移行（2026-11-20 C回・キュー 5-2） ----------
// version はコースの「形」の版。いまの版は 3。v1・v2・v3 は形が同じ
// （goalDist・checkpoint・step・jump・elevation・centerline・obstacles・
// name・version）で、変わったのは中身（中心線のS字・標高の大きさ・名前）
// だけなので、移行は形を変えず version だけ 3 にする。version が無い
// コースは版の管理が始まる前の一番古い v1 として扱う。この版より新しい
// version（4〜）はこの版では読めないため移行せず、理由を返す。移行は
// 読み込み時のみで、元のデータ（localStorage・埋め込みJSON）は書き換
// えない。移行しても形が壊れているコースは、このあとの validateCourse()
// で弾いて次へ落とす（移行は形を直さない）。
// この関数は他に依存しない形にしてある（COURSE_VERSION はこのファイル内）。
const COURSE_VERSION = 3;
function migrateCourse(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, reason: "コースがオブジェクトではありません" };
  const v = c.version;
  if (v === undefined || v === null) {
    // version が無いのは版の管理が始まる前のコース。形は v1 と同じ。
    const out = JSON.parse(JSON.stringify(c));
    out.version = COURSE_VERSION;
    return { ok: true, course: out, fromVersion: 1, note: "version が無かったため v1 として扱いました" };
  }
  if (!Number.isInteger(v) || v < 1) return { ok: false, reason: "version は 1 以上の整数にしてください（いま " + v + "）" };
  if (v > COURSE_VERSION) return { ok: false, reason: "このコースは version " + v + " で、この版（対応は version " + COURSE_VERSION + " まで）より新しいため読めません" };
  if (v === COURSE_VERSION) return { ok: true, course: c, fromVersion: v };
  // v1・v2：形は v3 と同じなので、中身はそのまま version だけ上げる。
  const out = JSON.parse(JSON.stringify(c));
  out.version = COURSE_VERSION;
  return { ok: true, course: out, fromVersion: v };
}
// 制御点の補間（標高・中心線とも同じ流儀：制御点間を smoothstep でつなぐ。
// 旧 slopeY（800→2600 の smoothstep）は制御点 0,0 / 800,0 / 2600,5 / 5800,5 と一致する）
function profileAt(pts, d, key) {
  if (d <= pts[0].d) return pts[0][key];
  for (let i = 1; i < pts.length; i++) {
    if (d <= pts[i].d) {
      const u = (d - pts[i - 1].d) / (pts[i].d - pts[i - 1].d);
      const s = 3 * u * u - 2 * u * u * u;
      return pts[i - 1][key] + (pts[i][key] - pts[i - 1][key]) * s;
    }
  }
  return pts[pts.length - 1][key];
}

root.DemaeCourse = { COURSE_VERSION, COURSE_DEFAULT, validateCourse, migrateCourse, profileAt };
})(typeof window !== "undefined" ? window : globalThis);
