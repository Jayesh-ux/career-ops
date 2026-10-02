(function(P){
  function ev(el){el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));}
  var mapn={name:P.name,email:P.email,phone:P.phone,linkedin:P.linkedin,github:P.github};
  for(var k in mapn){
    var w=[].filter.call(document.querySelectorAll('input[type=text],input[type=email],input[type=tel]'),function(i){
      var t=((i.name||'')+' '+(i.placeholder||'')+' '+(i.getAttribute('aria-label')||'')).toLowerCase();
      return t.indexOf(k)>-1;
    });
    if(w[0]){w[0].value=mapn[k];ev(w[0]);}
  }
  var groups={};
  document.querySelectorAll('input[type=radio]').forEach(function(x){var n=x.name;(groups[n]=groups[n]||[]).push(x);});
  for(var nm in groups){
    var opts=groups[nm],t=null;
    for(var i=0;i<opts.length;i++){
      var l=document.querySelector('label[for="'+opts[i].id+'"]')||(opts[i].parentElement?opts[i].parentElement.querySelector('label'):null);
      var tx=l?l.textContent.trim().toLowerCase():'';
      if(!t&&/^yes|^i am|^mumbai/i.test(tx))t=opts[i];
    }
    if(!t)t=opts[0];
    if(t&&!t.checked)t.click();
  }
  document.querySelectorAll('input[type=checkbox]').forEach(function(c){
    var l=document.querySelector('label[for="'+c.id+'"]');
    var tx=l?(l.textContent||'').toLowerCase():'';
    if(/author|consent|agree|share|privacy/i.test(tx)&&!c.checked)c.click();
  });
  function contextOf(el){
    var n=el;
    for(var i=0;i<3&&n;i++){ n=n.parentElement||n.parentNode; }
    return n?(n.textContent||''):'';
  }
  function sc(needle,v){
    document.querySelectorAll('textarea[name*=cards],input[name*=cards]').forEach(function(t2){
      var c=contextOf(t2).replace(/\s+/g,' ').toLowerCase();
      if(c.indexOf(needle)>-1&&!t2.value){t2.value=v;ev(t2);}
    });
  }
  sc('current',P.curr);
  sc('expected',P.exp);
  var count=0;
  document.querySelectorAll('textarea').forEach(function(t3){if(!t3.value&&t3.required){t3.value=P.exp;ev(t3);count++;}});
  return count;
})
