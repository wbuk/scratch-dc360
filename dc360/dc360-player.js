/* The teacher's Play for Scratch projects (dc360/player.html). Runs in a SANDBOXED frame (allow-scripts only): no
   cookies, no same-origin, so a student's project cannot reach the teacher's login. Added by the Libraries app updater
   (recipe scratch).
   1. The frame has no storage or cookies, and Scratch reads both while it starts: stand-ins are put first.
   2. Scratch's player starts (player.js); this finds its engine (the VM) through React.
   3. It tells the teacher's page it is ready; the page posts the .sb3; it is loaded and started with the green flag. */
(function (w, d) {
    'use strict';

    // 1. Storage that only lasts while the frame is open (reading the real one throws in a sandbox).
    try {
        w.localStorage.getItem('x');
    } catch (e) {
        var mem = {};
        var fake = {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
            setItem: function (k, v) { mem[k] = String(v); },
            removeItem: function (k) { delete mem[k]; },
            clear: function () { mem = {}; },
            key: function (i) { return Object.keys(mem)[i] || null; },
            get length() { return Object.keys(mem).length; }
        };
        try { Object.defineProperty(w, 'localStorage', { value: fake, configurable: true }); } catch (e2) { /* Scratch copes */ }
        try { Object.defineProperty(w, 'sessionStorage', { value: fake, configurable: true }); } catch (e3) { /* Scratch copes */ }
    }

    // Scratch also reads document.cookie (its language setting), which throws in a sandbox: no cookies here.
    try {
        void d.cookie;
    } catch (e) {
        try { Object.defineProperty(d, 'cookie', { get: function () { return ''; }, set: function () {}, configurable: true }); } catch (e2) { /* Scratch copes */ }
    }

    // Nothing from the computer, and no links out of the frame.
    w.open = function () { return null; };

    function engine() {
        var root = d.querySelector('[class*="gui_page-wrapper"], [class*="gui_body-wrapper"], [class*="stage-wrapper"], [class*="stage_stage"]');
        if (!root) { return null; }
        var k = Object.keys(root).find(function (x) { return x.indexOf('__reactFiber') === 0 || x.indexOf('__reactInternalInstance') === 0; });
        for (var f = k ? root[k] : null, i = 0; f && i < 200; i++, f = f.return) {
            var p = f.memoizedProps;
            if (p && p.vm && p.vm.runtime && p.vm.loadProject) { return p.vm; }
        }
        return null;
    }

    function fail(msg) {
        var n = d.getElementById('dc360PlWait');
        if (n) { n.textContent = msg; n.style.display = 'flex'; }
        try { w.parent.postMessage({ type: 'dc360-player-failed' }, '*'); } catch (e) { /* the page shows its own message */ }
    }

    var vm = null;

    /* The player is drawn at Scratch's own size: shrink (or grow) it to fill the teacher's box, with no scroll bars. */
    function fit() {
        var b = d.body;
        b.style.zoom = '';
        // The stage is drawn at a fixed 480 x 360 below the green flag bar; the page hides what does not fit, so the
        // stage itself is measured (not the page's scroll size).
        var s = d.querySelector('[class*="stage-wrapper"]') || b;
        var r = s.getBoundingClientRect();
        var wide = r.right + Math.max(0, r.left), high = r.bottom + 4;
        var z = Math.min(w.innerWidth / Math.max(1, wide), w.innerHeight / Math.max(1, high));
        if (z > 0 && Math.abs(z - 1) > 0.02) { b.style.zoom = String(Math.min(z, 2)); }
    }

    w.addEventListener('message', function (e) {
        if (e.source !== w.parent || !e.data || e.data.type !== 'dc360-play' || !(e.data.sb3 instanceof ArrayBuffer) || !vm) { return; }
        vm.loadProject(e.data.sb3).then(function () {
            var n = d.getElementById('dc360PlWait');
            if (n) { n.style.display = 'none'; }
            // The player example's own "See inside" button (it would open the editor in this frame): not needed here.
            Array.prototype.forEach.call(d.querySelectorAll('body > div > button, body > div > div > button'), function (b) {
                if (!b.closest('[class*="stage-header"], [class*="controls"]')) { b.remove(); }
            });
            fit();
            w.addEventListener('resize', fit);
            vm.start();
            vm.greenFlag();
        }, function () { fail('This project could not be played.'); });
    });

    (function wait(tries) {
        vm = engine();
        if (!vm) {
            if (tries < 300) { setTimeout(function () { wait(tries + 1); }, 100); } else { fail('Scratch could not start.'); }
            return;
        }
        w.parent.postMessage({ type: 'dc360-player-ready' }, '*');
    })(0);
})(window, document);
