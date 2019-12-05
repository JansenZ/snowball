
import { $ } from '../../utils';
import { ViewModel } from '../../vm';
import { ActivityOptions } from '../types';
import ReactViewHandler from '../react/ReactViewHandler';
import SnowballViewHandler from './SnowballViewHandler';
import { Page } from './Page';

const ACTIVITY_STATUS_INIT = 0;
const ACTIVITY_STATUS_CREATE = 1;
const ACTIVITY_STATUS_RESUME = 2;
const ACTIVITY_STATUS_PAUSE = 3;
const ACTIVITY_STATUS_DESTROY = 4;

/**
 * 页面控制器
 * @param {*} viewClass 视图类
 * @param {*} location 地址信息
 * @param {Application} application 应用
 * @param {*} mapStoreToProps 转换props的方法
 */
export class Activity {

    constructor(viewFactory, location, application, mapStoreToProps, options?: ActivityOptions) {
        this.application = application;
        this.isActive = true;
        this.status = ACTIVITY_STATUS_INIT;

        this.$el = $('[route-path="' + location.path + '"][ssr]');
        if (!this.$el.length) {
            this.$el = $('<div class="app-view"'
                + (!application.currentActivity ? ' style="opacity:0"' : '')
                + ' route-path="' + location.path + '"></div>')
                .appendTo(application.rootElement);
        } else {
            this.$el.removeAttr('ssr');
        }
        this.location = location;
        this.el = this.$el[0];
        this.page = new Page(this, application.ctx);

        if (options) {
            this.transition = options.transition;
        }

        const ViewHandler = viewFactory.prototype instanceof ViewModel
            ? SnowballViewHandler
            : ReactViewHandler;

        this.view = new ViewHandler({
            el: this.el,
            viewFactory,
            location,
            mapStoreToProps,
            activity: this,
            page: this.page
        });

        this.view.ready(() => {
            this.lifecycle.onInit && this.lifecycle.onInit(this.page.ctx);
            this.page.trigger('init');
        });
    }

    setTransitionTask(transitionTask) {
        this.transitionTask = transitionTask;
        return this;
    }

    whenNotInTransition(fn) {
        if (!this.transitionTask) {
            console.error('call `setTransitionTask` first!');
            fn();
            return;
        }
        this.transitionTask.then(fn);
        return this;
    }

    setProps(props, cb) {
        this.view.update(props, cb);
        return this;
    }

    qsChange() {
        if (typeof this.lifecycle.onQsChange === 'function') {
            this.lifecycle.onQsChange(this.page.ctx);
        }
        this.page.trigger('qschange');
    }

    /**
     * 页面显示，动画结束时触发
     * 若有上个页面，等待上个页面销毁或pause时触发
     * @param {*} callback
     */
    show(callback) {
        this.view.ready(() => {
            this.isActive = true;
            this.$el.addClass('app-view-actived');
            if (typeof this.lifecycle.onShow === 'function') {
                this.lifecycle.onShow(this.page.ctx);
            }
            this.page.trigger('show');
            callback && callback();
        });
    }

    /**
     * 页面进入前台时调用，若是第一次进入，则触发create，否则触发resume
     */
    active() {
        if (this.status == ACTIVITY_STATUS_INIT) {
            this.status = ACTIVITY_STATUS_CREATE;
            if (typeof this.lifecycle.onCreate === 'function') {
                this.lifecycle.onCreate(this.page.ctx);
            }
            this.page.trigger('create');
        } else if (this.status == ACTIVITY_STATUS_PAUSE) {
            this.status = ACTIVITY_STATUS_RESUME;
            if (typeof this.lifecycle.onResume === 'function') {
                this.lifecycle.onResume(this.page.ctx);
            }
            this.page.trigger('resume');
        }
        return this;
    }

    /**
     * 页面进入底层时调用
     */
    pause() {
        if (this.status == ACTIVITY_STATUS_RESUME || this.status == ACTIVITY_STATUS_CREATE || this.status == ACTIVITY_STATUS_INIT) {
            this.status = ACTIVITY_STATUS_PAUSE;
            this.isActive = false;
            if (typeof this.lifecycle.onPause === 'function') {
                this.lifecycle.onPause(this.page.ctx);
            }
            document.activeElement && document.activeElement.blur();
            this.page.trigger('pause');
        }
        return this;
    }

    /**
     * 销毁当前页面，调用navigation.back()时会销毁当前页面
     */
    destroy() {
        if (!this.isDestroyed) {
            this.isDestroyed = true;
            this.isActive = false;
            this.status = ACTIVITY_STATUS_DESTROY;

            document.activeElement && document.activeElement.blur();

            this.view.destroy();
            this.view = null;
            this.$el.remove();
            this.$el = this.el = null;

            if (typeof this.lifecycle.onDestroy === 'function') {
                this.lifecycle.onDestroy(this.page.ctx);
            }
            this.page.trigger('destroy');
            this.page.off();
        }
    }
}

Activity.prototype.lifecycle = {};

export default Activity;