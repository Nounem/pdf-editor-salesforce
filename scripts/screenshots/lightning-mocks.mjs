// Lightweight local adapters for screenshot generation only. Never deployed to Salesforce.
const sharedCss = `:host{display:inline-block;font-family:'Salesforce Sans',sans-serif;font-size:12px;color:#18313c}button{font:inherit;cursor:pointer;border:1px solid #82939b;border-radius:4px;background:white;color:#18313c;min-height:32px;padding:0 13px;white-space:nowrap}button.brand{background:#183f4e;color:white;border-color:#183f4e}button.base{border:0;background:transparent;color:#196883;padding:0 6px}button.destructive-text{color:#a93f30}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #0076a8;outline-offset:2px}label{display:block;font-size:11px;margin:0 0 6px;color:#435862}input,select{font:inherit;box-sizing:border-box;width:100%;height:34px;border:1px solid #96a6ad;border-radius:4px;padding:0 9px;background:white;color:#18313c}input:disabled,select:disabled{background:#f5f6f7;opacity:.6}input[type=color]{padding:3px}input{min-width:0}`;

export const mocks = {
    'lightning/button.js': `import {LightningElement,api} from 'lwc'; export default class Button extends LightningElement { @api label; @api disabled=false; @api variant='neutral'; @api iconName; }`,
    'lightning/button.html': `<template><button type="button" class={variant} disabled={disabled}>{label}</button></template>`,
    'lightning/button.css': sharedCss,
    'lightning/buttonIcon.js': `import {LightningElement,api} from 'lwc'; export default class ButtonIcon extends LightningElement { @api alternativeText; @api disabled=false; @api iconName; get symbol(){return {'utility:undo':'↶','utility:redo':'↷','utility:chevronleft':'‹','utility:chevronright':'›'}[this.iconName] || '·';}}`,
    'lightning/buttonIcon.html': `<template><button type="button" disabled={disabled} aria-label={alternativeText} title={alternativeText}>{symbol}</button></template>`,
    'lightning/buttonIcon.css': sharedCss + 'button{font-size:20px;padding:0 10px;}',
    'lightning/input.js': `import {LightningElement,api} from 'lwc'; export default class Input extends LightningElement { @api label; @api value=''; @api type='text'; @api disabled=false; @api maxLength; @api min; @api max; @api step; input(event){this.value=event.target.value;this.dispatchEvent(new CustomEvent('change',{detail:{value:this.value}}));} commit(event){this.value=event.target.value;this.dispatchEvent(new CustomEvent('commit'));}}`,
    'lightning/input.html': `<template><label for="field">{label}</label><input id="field" type={type} value={value} disabled={disabled} maxlength={maxLength} min={min} max={max} step={step} oninput={input} onchange={commit} /></template>`,
    'lightning/input.css': sharedCss + ':host{display:block;width:100%}',
    'lightning/combobox.js': `import {LightningElement,api} from 'lwc'; export default class Combobox extends LightningElement { @api label; @api value=''; @api options=[]; @api disabled=false; @api placeholder; get choices(){return this.options.map(option=>({...option,selected:option.value===this.value}));} change(event){this.value=event.target.value;this.dispatchEvent(new CustomEvent('change',{detail:{value:this.value}}));}}`,
    'lightning/combobox.html': `<template><label for="choices">{label}</label><select id="choices" disabled={disabled} onchange={change}><option lwc:if={placeholder} value="">{placeholder}</option><template for:each={choices} for:item="option"><option key={option.value} value={option.value} selected={option.selected}>{option.label}</option></template></select></template>`,
    'lightning/combobox.css': sharedCss + ':host{display:block;width:100%}',
    'lightning/confirm.js': `export default {open:async()=>true};`,
    'lightning/platformResourceLoader.js': `export async function loadScript(){if(!window.LovePdfEngine)throw new Error('Missing PDF engine');}`,
    'lightning/navigation.js': `export const NavigationMixin=(Base)=>class extends Base{[NavigationMixin.Navigate](){window.demoPreviewOpened=true;}};NavigationMixin.Navigate=Symbol('navigate');`,
    'apex/listRecordPdfs.js': `export default async()=>[{title:'Devis Atelier Horizon',size:window.demoPdf.length,versionId:'demo-version'}];`,
    'apex/loadSmallPdf.js': `export default async()=>({title:'Devis Atelier Horizon',versionId:'demo-version',base64:window.demoPdfBase64});`,
    'apex/saveCopy.js': `export default async(request)=>{window.demoSavedRequest=request;return{documentId:'demo-copy',versionId:'demo-copy-version'};};`,
    'resource.js': `export default '/engine.js';`
};

export const componentNames = new Set(['button', 'buttonIcon', 'input', 'combobox']);
