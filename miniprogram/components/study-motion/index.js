'use strict';
Component({
  properties: { enabled: { type: Boolean, value: true } },
  data: { ready: false },
  observers: { enabled() { this.updatePlayback(); } },
  methods: {
    updatePlayback() {
      if (!this.animation || !this.data.ready || this.disposed) return;
      if (this.hidden) this.animation.pause();
      else if (!this.properties.enabled) this.animation.goToAndStop(this.lastFrame, true);
      else if (!this.completed) this.animation.play();
    },
    releaseAnimation() {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
      const animation = this.animation;
      this.animation = null;
      if (animation) animation.destroy();
    },
    useFallback() {
      this.releaseAnimation();
      if (!this.disposed) this.setData({ ready: false });
    }
  },
  lifetimes: {
    attached() { this.disposed = false; this.hidden = false; this.completed = false; },
    ready() {
      this.createSelectorQuery().select('#studyCanvas').fields({ node: true, size: true }).exec(results => {
        if (this.disposed) return;
        const result = results && results[0];
        if (!result || !result.node || !result.width || !result.height) return;
        try {
          const canvas = result.node, context = canvas.getContext('2d');
          const lottie = require('../../vendor/lottie/index');
          const animationData = require('../../assets/study-motion');
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const dpr = info.pixelRatio > 0 ? info.pixelRatio : 1;
          canvas.width = Math.round(result.width * dpr); canvas.height = Math.round(result.height * dpr);
          lottie.setup(canvas);
          this.lastFrame = Math.max(0, animationData.op - animationData.ip - 1);
          // The miniprogram renderer measures context.canvas.width in backing pixels.
          // Density is already applied above; passing dpr again scales content outside the canvas.
          this.animation = lottie.loadAnimation({ loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(animationData)), rendererSettings: { context, clearCanvas: true, dpr: 1 } });
          this.readyTimer = setTimeout(() => this.useFallback(), 2000);
          this.animation.addEventListener('DOMLoaded', () => {
            if (this.disposed || !this.animation) return;
            clearTimeout(this.readyTimer); this.readyTimer = null;
            this.setData({ ready: true }); this.updatePlayback();
          });
          this.animation.addEventListener('complete', () => { this.completed = true; });
          this.animation.addEventListener('data_failed', () => this.useFallback());
          this.animation.addEventListener('error', () => this.useFallback());
        } catch (error) {
          this.useFallback();
          console.warn('[appearance] animation fallback', error && error.message);
        }
      });
    },
    detached() { this.disposed = true; this.releaseAnimation(); }
  },
  pageLifetimes: {
    hide() { this.hidden = true; if (this.animation) this.animation.pause(); },
    show() { this.hidden = false; this.updatePlayback(); }
  }
});
