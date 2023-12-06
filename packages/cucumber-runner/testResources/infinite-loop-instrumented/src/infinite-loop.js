// This file is generated with tasks/instrument-test-resources.js
 function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker2__ || (g.__stryker2__ = {});
  if (ns.activeMutants === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutants = new Set([g.process.env.__STRYKER_ACTIVE_MUTANT__]);
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutants !== undefined && ns.activeMutants.has(id)) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
function loop(n, action) {
  if (stryMutAct_9fa48("8")) {
    {}
  } else {
    stryCov_9fa48("8");
    let goOn = stryMutAct_9fa48("9") ? false : (stryCov_9fa48("9"), true);
    while (stryMutAct_9fa48("10") ? false : (stryCov_9fa48("10"), goOn)) {
      if (stryMutAct_9fa48("11")) {
        {}
      } else {
        stryCov_9fa48("11");
        action(n);
        stryMutAct_9fa48("12") ? n++ : (stryCov_9fa48("12"), n--);
        goOn = stryMutAct_9fa48("16") ? n <= 0 : stryMutAct_9fa48("15") ? n >= 0 : stryMutAct_9fa48("14") ? false : stryMutAct_9fa48("13") ? true : (stryCov_9fa48("13", "14", "15", "16"), n > 0);
      }
    }
  }
}
module.exports = loop;