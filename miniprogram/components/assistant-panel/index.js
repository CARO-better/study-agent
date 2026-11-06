'use strict';
const controller = require('../../lib/assistant')();
const methods = {};
for (const [name, value] of Object.entries(controller)) {
  if (typeof value === 'function' && !name.startsWith('on')) methods[name] = value;
}

Component({
  options: {styleIsolation: 'apply-shared'},
  properties: {top: {type: Number, value: 44}, settingsOpen: {type: Boolean, value: false}},
  data: controller.data,
  methods: {...methods, dismiss() {this.triggerEvent('dismiss');}, stop() {}},
  lifetimes: {
    attached() {
      controller.onLoad.call(this);
      if (this.properties.settingsOpen) this.openSettings();
    },
    detached() {controller.onUnload.call(this);}
  },
  pageLifetimes: {hide() {controller.onHide.call(this);}}
});
