/* Opt-in analytics; never load in local preview. */
(function () {
  'use strict';
  const key='m360_analytics_consent';
  const production=['movilidad360sv.com','www.movilidad360sv.com'].includes(location.hostname);
  let loaded=false;
  function allowed(){try{return localStorage.getItem(key)==='yes';}catch{return false;}}
  function start(){
    if(!production || !allowed() || loaded)return;
    loaded=true; window['ga-disable-G-F59WF19VVM']=false;
    window.dataLayer=window.dataLayer||[];
    window.gtag=function(){window.dataLayer.push(arguments);};
    window.gtag('js',new Date());
    window.gtag('config','G-F59WF19VVM',{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});
    window.gtag('event','page_view',{page_location:location.origin+location.pathname,page_title:document.title});
    const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id=G-F59WF19VVM';document.head.appendChild(script);
  }
  window.M360Analytics={allowed,setAllowed(value){
    try{localStorage.setItem(key,value?'yes':'no');}catch{}
    window['ga-disable-G-F59WF19VVM']=!value;
    if(value)start();
    else {
      for(const c of document.cookie.split(';')){const name=c.split('=')[0].trim();if(name.startsWith('_ga'))for(const domain of ['', '; domain='+location.hostname, '; domain=.movilidad360sv.com'])document.cookie=name+'=; Max-Age=0; path=/'+domain;}
    }
  }};
  const events=new Set(['address_search','address_search_error','quote_review','request_handoff','contact_handoff','agency_contact','job_handoff','whatsapp_click']);
  window.m360Track=(name,params={})=>{
    if(!production || !allowed() || !events.has(name) || typeof window.gtag!=='function')return;
    const safe={};
    for(const key of ['service','field','reason','action','link_id']) if(/^[a-z0-9_-]{1,60}$/i.test(params[key]||''))safe[key]=params[key];
    window.gtag('event',name,safe);
  };
  start();
})();
