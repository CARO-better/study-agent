'use strict';
const controller = require('../../lib/assistant')();
const methods = {};
for (const [name, value] of Object.entries(controller)) {
  if (typeof value === 'function' && !name.startsWith('on')) methods[name] = value;
}

Component({
  options: {styleIsolation: 'apply-shared'},
  properties: {top: {type: Number, value: 44}, orbTop: {type: Number, value: 44}, closing: {type: Boolean, value: false}, settingsOpen: {type: Boolean, value: false}},
  data: controller.data,
  methods: {...methods,
    dismiss() {this.triggerEvent('dismiss');},
    beginClose() {
      if (this._closing) return;
      this._closing = true;
      controller.onUnload.call(this);
    },
    stop() {}
  },
  lifetimes: {
    attached() {
      this._closing = false;
      controller.onLoad.call(this);
      if (this.properties.settingsOpen) this.openSettings();
    },
    ready() {
      if (this.measurePanel) this.measurePanel();
    },
    detached() {controller.onUnload.call(this);}
  },
  pageLifetimes: {hide() {controller.onHide.call(this);}}
});
