module.exports = {
    // 本项目只保留 Markdown 排版：不要图表、公式、流程图、音频（用户已明确图表延后）

    // markdown解析配置，保留需要的选项即可
    markdown:[
        'sub',                      // 下标支持
        'sup',                      // 上标支持
        'ins',                      // 文本删除线支持
        'mark',                     // 文本高亮支持
        'emoji',                    // emoji表情支持
        'todo'                      // todo支持
    ],

    // 代码高亮：关闭。语言包是 ESM 语法，Node 无法直接验证，小程序端也无法在本地测试；
    // AI 回复以标题/列表/表格为主，不需要语法高亮，先保证能跑。
    highlight:[
    ],

    // wxml原生标签，该系列标签将不会被转换
    wxml:[
        'view',
        'video',
        'text',
        'image',
        'navigator',
        'swiper',
        'swiper-item',
        'block',
        'form',
        'input',
        'textarea',
        'button',
        'checkbox-group',
        'checkbox',
        'radio-group',
        'radio',
        'rich-text',

        // 可以解析的标签（html或markdown中会很少使用）
        // 'canvas',
        // 'map',
        // 'slider',
        // 'scroll-view',
        // 'movable-area',
        // 'movable-view',
        // 'progress',
        // 'label',
        // 'switch',
        // 'picker',
        // 'picker-view',
        // 'switch',
        // 'contact-button'
    ],

    // 自定义组件
    components:[
        'table',                    // 表格支持
        'todogroup',                // todo支持
        'img'                       // 图片解析组件
    ],

    // 保留原本的元素属性（建议不要变动）
    attrs:[
        'class',
        'data',
        'id',
        'style'
    ],

    // 事件绑定方式（catch或bind），catch 会阻止事件向上冒泡。更多请参考：https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxml/event.html
    bindType:'catch',

    // 需要激活的事件
    events:[
        // 'touchstart',
        // 'touchmove',
        // 'touchcancel',
        // 'touchend',
        'tap',                      // 用于元素的点击事件
        'change',                   // 用于todoList的change事件
    ],

    // 图片倍数
    dpr:1,

    // 代码块显示行号
    showLineNumber:true
}