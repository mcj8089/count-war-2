/* Pointer / keyboard steering. Dragging moves the swarm anchor laterally; the crowd chases it. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.laneX = 0;
    this.keys = { left: false, right: false };
    this.dragging = false;
    this.lastPx = 0;
    this.sensitivity = 1.5;
    this.enabled = false;
    this.bounds = { left: -6.2, right: 6.2 };
    this.onFirstGesture = null;
    this._bind();
  }

  setBounds(halfWidth) {
    this.bounds = { left: -halfWidth + 1.1, right: halfWidth - 1.1 };
    this.laneX = clamp(this.laneX, this.bounds.left, this.bounds.right);
  }

  _bind() {
    const el = this.canvas;
    const down = (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      this.lastPx = e.clientX;
      el.setPointerCapture?.(e.pointerId);
      this.onFirstGesture?.();
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.dragging || !this.enabled) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const dx = e.clientX - this.lastPx;
      this.lastPx = e.clientX;
      /* 追逐相机位于人群后方、朝 +Z 看，世界 +X 渲染在屏幕左侧；
         因此屏幕方向与世界 X 相反：鼠标向右（dx>0）要往 -X 走，视觉上才向右。 */
      const worldPerPx = (this.bounds.right - this.bounds.left) * this.sensitivity / width;
      this.laneX = clamp(this.laneX - dx * worldPerPx, this.bounds.left, this.bounds.right);
    };
    const up = () => { this.dragging = false; };

    el.addEventListener('pointerdown', down, { passive: false });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });

    const keymap = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right'
    };
    window.addEventListener('keydown', (e) => {
      const k = keymap[e.code];
      if (!k) return;
      this.keys[k] = true;
      this.onFirstGesture?.();
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const k = keymap[e.code];
      if (k) this.keys[k] = false;
    });
  }

  update(dt, laneSpeed = 13) {
    if (!this.enabled) return this.laneX;
    /* 键盘同样按屏幕方向映射：右键 = 屏幕 right = 世界 -X（见 move 内注释）。 */
    const dir = (this.keys.left ? 1 : 0) - (this.keys.right ? 1 : 0);
    if (dir) this.laneX = clamp(this.laneX + dir * laneSpeed * dt, this.bounds.left, this.bounds.right);
    return this.laneX;
  }

  snapTo(x) {
    this.laneX = clamp(x, this.bounds.left, this.bounds.right);
  }
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export default Input;
