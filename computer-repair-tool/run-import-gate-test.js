var fs=require('fs');
var vm=require('vm');

global.window=global;
global.document={addEventListener:function(){}};

var memoryStore={};
global.localStorage={
  getItem:function(k){return memoryStore[k]===undefined?null:memoryStore[k];},
  setItem:function(k,v){memoryStore[k]=String(v);},
  removeItem:function(k){delete memoryStore[k];},
  clear:function(){memoryStore={};}
};

var appCode=fs.readFileSync(__dirname+'/app.js','utf8');
vm.runInThisContext(appCode);

var testCode=fs.readFileSync(__dirname+'/test-import-gate.js','utf8');
vm.runInThisContext(testCode);

global.TestImportGate.runAllTests();

global.TestImportGate.TestRunner.waitDone().then(function(){
  var r=global.TestImportGate.TestRunner.summary();
  console.log('\n\n========== 测试结果 ==========');
  console.log('总用例:',r.total);
  console.log('通过数:',r.passed);
  console.log('失败数:',r.failed);
  console.log('通过率:',r.passRate+'%');
  if(r.failed>0){
    console.log('\n失败用例:');
    global.TestImportGate.TestRunner.getTests().filter(function(t){return !t.pass;}).forEach(function(t){
      console.log('  ❌',t.name);
      if(t.error)console.log('     ',t.error);
    });
  }
  global.TEST_RESULT=r;
  process.exit(r.failed===0?0:1);
});
