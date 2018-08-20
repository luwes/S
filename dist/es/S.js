// Public interface
var S = function S(fn, value) {
    var node = makeComputationNode(fn, value);
    if (node === null) {
        value = getLastNodeValue();
        return function computation() { return value; };
    }
    else {
        return function computation() {
            return node.current();
        };
    }
};
// compatibility with commonjs systems that expect default export to be at require('s.js').default rather than just require('s-js')
Object.defineProperty(S, 'default', { value: S });
export default S;
S.root = function root(fn) {
    var root = null, initialized = false;
    if (fn.length === 0) {
        return unowned(fn);
    }
    else {
        root = makeRootNode(fn, function _dispose() {
            if (!initialized) {
                throw new Error("cannot dispose of an S.root() while it is still being created");
            }
            else if (root === null) {
                // nothing to do
            }
            else if (RunningClock !== null) {
                RootClock.disposes.add(root);
            }
            else {
                dispose(root);
            }
        });
        initialized = true;
        return getLastNodeValue();
    }
};
S.on = function on(ev, fn, seed, onchanges) {
    if (Array.isArray(ev))
        ev = callAll(ev);
    onchanges = !!onchanges;
    return S(on, seed);
    function on(value) {
        var listener = Listener;
        ev();
        if (onchanges)
            onchanges = false;
        else {
            Listener = null;
            value = fn(value);
            Listener = listener;
        }
        return value;
    }
};
function callAll(ss) {
    return function all() {
        for (var i = 0; i < ss.length; i++)
            ss[i]();
    };
}
S.effect = function effect(fn, value) {
    var node = makeComputationNode(fn, value);
    if (node === null)
        LastValue = undefined;
};
S.data = function data(value) {
    var node = new DataNode(value);
    return function data(value) {
        if (arguments.length === 0) {
            return node.current();
        }
        else {
            return node.next(value);
        }
    };
};
S.value = function value(current, eq) {
    var data = S.data(current), age = -1;
    return function value(update) {
        if (arguments.length === 0) {
            return data();
        }
        else {
            var same = eq ? eq(current, update) : current === update;
            if (!same) {
                var time = RootClock.time;
                if (age === time)
                    throw new Error("conflicting values: " + update + " is not the same as " + current);
                age = time;
                current = update;
                data(update);
            }
            return update;
        }
    };
};
S.freeze = function freeze(fn) {
    var result = undefined;
    if (RunningClock !== null) {
        result = fn();
    }
    else {
        RunningClock = RootClock;
        RunningClock.changes.reset();
        try {
            result = fn();
            event();
        }
        finally {
            RunningClock = null;
        }
    }
    return result;
};
S.sample = function sample(fn) {
    var result, listener = Listener;
    if (listener !== null) {
        Listener = null;
        result = fn();
        Listener = listener;
    }
    else {
        result = fn();
    }
    return result;
};
S.cleanup = function cleanup(fn) {
    if (Owner === null)
        console.warn("cleanups created without a root or parent will never be run");
    else if (Owner === LAZYNODE) {
        Owner = new ComputationNode();
        if (Listener === LAZYNODE)
            Listener = Owner;
        Owner.cleanups = [fn];
    }
    else if (Owner.cleanups === null)
        Owner.cleanups = [fn];
    else
        Owner.cleanups.push(fn);
};
// experimental : exposing node constructors and some state
S.makeDataNode = function makeDataNode(value) {
    return new DataNode(value);
};
S.makeComputationNode = makeComputationNode;
S.getLastNodeValue = getLastNodeValue;
S.makeRootNode = makeRootNode;
S.disposeNode = function disposeNode(node) {
    if (RunningClock !== null) {
        RootClock.disposes.add(node);
    }
    else {
        dispose(node);
    }
};
S.isFrozen = function isFrozen() {
    return RunningClock !== null;
};
S.isListening = function isListening() {
    return Listener !== null;
};
// Internal implementation
/// Graph classes and operations
var Clock = /** @class */ (function () {
    function Clock() {
        this.time = 0;
        this.changes = new Queue(); // batched changes to data nodes
        this.updates = new Queue(); // computations to update
        this.disposes = new Queue(); // disposals to run after current batch of updates finishes
    }
    return Clock;
}());
var RootClockProxy = {
    time: function () { return RootClock.time; }
};
var DataNode = /** @class */ (function () {
    function DataNode(value) {
        this.value = value;
        this.pending = NOTPENDING;
        this.log = null;
    }
    DataNode.prototype.current = function () {
        if (Listener !== null) {
            logDataRead(this);
        }
        return this.value;
    };
    DataNode.prototype.next = function (value) {
        if (RunningClock !== null) {
            if (this.pending !== NOTPENDING) { // value has already been set once, check for conflicts
                if (value !== this.pending) {
                    throw new Error("conflicting changes: " + value + " !== " + this.pending);
                }
            }
            else { // add to list of changes
                this.pending = value;
                RootClock.changes.add(this);
            }
        }
        else { // not batching, respond to change now
            if (this.log !== null) {
                this.pending = value;
                RootClock.changes.add(this);
                event();
            }
            else {
                this.value = value;
            }
        }
        return value;
    };
    DataNode.prototype.clock = function () {
        return RootClockProxy;
    };
    return DataNode;
}());
var ComputationNode = /** @class */ (function () {
    function ComputationNode() {
        this.fn = null;
        this.value = undefined;
        this.age = -1;
        this.state = CURRENT;
        this.source1 = null;
        this.source1slot = 0;
        this.sources = null;
        this.sourceslots = null;
        this.log = null;
        this.owned = null;
        this.cleanups = null;
    }
    ComputationNode.prototype.current = function () {
        if (Listener !== null) {
            if (this.age === RootClock.time) {
                if (this.state === RUNNING)
                    throw new Error("circular dependency");
                else
                    updateNode(this); // checks for state === STALE internally, so don't need to check here
            }
            logComputationRead(this);
        }
        return this.value;
    };
    ComputationNode.prototype.clock = function () {
        return RootClockProxy;
    };
    return ComputationNode;
}());
var Log = /** @class */ (function () {
    function Log() {
        this.node1 = null;
        this.node1slot = 0;
        this.nodes = null;
        this.nodeslots = null;
    }
    return Log;
}());
var Queue = /** @class */ (function () {
    function Queue() {
        this.items = [];
        this.count = 0;
    }
    Queue.prototype.reset = function () {
        this.count = 0;
    };
    Queue.prototype.add = function (item) {
        this.items[this.count++] = item;
    };
    Queue.prototype.run = function (fn) {
        var items = this.items;
        for (var i = 0; i < this.count; i++) {
            fn(items[i]);
            items[i] = null;
        }
        this.count = 0;
    };
    return Queue;
}());
// Constants
var NOTPENDING = {}, CURRENT = 0, STALE = 1, RUNNING = 2;
// "Globals" used to keep track of current system state
var RootClock = new Clock(), RunningClock = null, // currently running clock 
Listener = null, // currently listening computation
Owner = null, // owner for new computations
UNOWNED = new ComputationNode(), LAZYNODE = new ComputationNode(), LastValue = undefined;
// Functions
function makeComputationNode(fn, value) {
    var node = null, owner = Owner, listener = Listener, topLevel = RunningClock === null, i;
    if (owner === null)
        console.warn("computations created without a root or parent will never be disposed");
    Owner = Listener = LAZYNODE;
    if (topLevel) {
        value = toplevelComputation(fn, value);
    }
    else {
        value = fn(value);
    }
    node = Owner;
    if (node === LAZYNODE) {
        node = null;
    }
    else if (node.source1 !== null) {
        node.fn = fn;
        node.value = value;
        node.age = RootClock.time;
        if (owner !== null && owner !== UNOWNED) {
            if (owner === LAZYNODE)
                owner = new ComputationNode();
            if (listener === LAZYNODE)
                listener = owner;
            if (owner.owned === null)
                owner.owned = [node];
            else
                owner.owned.push(node);
        }
    }
    else if (owner !== null && owner !== UNOWNED) {
        if (owner === LAZYNODE)
            owner = new ComputationNode();
        if (listener === LAZYNODE)
            listener = owner;
        if (node.owned !== null) {
            if (owner.owned === null)
                owner.owned = node.owned;
            else
                for (i = 0; i < node.owned.length; i++) {
                    owner.owned.push(node.owned[i]);
                }
        }
        if (node.cleanups !== null) {
            if (owner.cleanups === null)
                owner.cleanups = node.cleanups;
            else
                for (i = 0; i < node.cleanups.length; i++) {
                    owner.cleanups.push(node.cleanups[i]);
                }
        }
        node = null;
    }
    if (topLevel) {
        finishTopLevelComputation();
    }
    Owner = owner;
    Listener = listener;
    LastValue = node === null ? value : undefined;
    return node;
}
function getLastNodeValue() {
    var value = LastValue;
    LastValue = undefined;
    return value;
}
function toplevelComputation(fn, value) {
    var node;
    RunningClock = RootClock;
    RootClock.changes.reset();
    RootClock.updates.reset();
    try {
        value = fn(value);
        node = Owner;
    }
    finally {
        RunningClock = Owner = Listener = null;
    }
    Owner = Listener = node;
    return value;
}
function finishTopLevelComputation() {
    try {
        if (RootClock.changes.count > 0 || RootClock.updates.count > 0) {
            RootClock.time++;
            run(RootClock);
        }
    }
    finally {
        RunningClock = Owner = Listener = null;
    }
}
function makeRootNode(fn, p) {
    var owner = Owner, node = null;
    Owner = LAZYNODE;
    try {
        LastValue = fn(p);
        node = Owner === LAZYNODE ? null : Owner;
    }
    finally {
        Owner = owner;
    }
    return node;
}
function unowned(fn) {
    var owner = Owner;
    Owner = UNOWNED;
    try {
        return fn();
    }
    finally {
        Owner = owner;
    }
}
function logRead(from) {
    var to = Listener === LAZYNODE ? Owner = Listener = new ComputationNode() : Listener, fromslot, toslot = to.source1 === null ? -1 : to.sources === null ? 0 : to.sources.length;
    if (from.node1 === null) {
        from.node1 = to;
        from.node1slot = toslot;
        fromslot = -1;
    }
    else if (from.nodes === null) {
        from.nodes = [to];
        from.nodeslots = [toslot];
        fromslot = 0;
    }
    else {
        fromslot = from.nodes.length;
        from.nodes.push(to);
        from.nodeslots.push(toslot);
    }
    if (to.source1 === null) {
        to.source1 = from;
        to.source1slot = fromslot;
    }
    else if (to.sources === null) {
        to.sources = [from];
        to.sourceslots = [fromslot];
    }
    else {
        to.sources.push(from);
        to.sourceslots.push(fromslot);
    }
}
function logDataRead(data) {
    if (data.log === null)
        data.log = new Log();
    logRead(data.log);
}
function logComputationRead(node) {
    if (node.log === null)
        node.log = new Log();
    logRead(node.log);
}
function event() {
    // b/c we might be under a top level S.root(), have to preserve current root
    var owner = Owner;
    RootClock.updates.reset();
    RootClock.time++;
    try {
        run(RootClock);
    }
    finally {
        RunningClock = Listener = null;
        Owner = owner;
    }
}
function run(clock) {
    var running = RunningClock, count = 0;
    RunningClock = clock;
    clock.disposes.reset();
    // for each batch ...
    while (clock.changes.count !== 0 || clock.updates.count !== 0 || clock.disposes.count !== 0) {
        if (count > 0) // don't tick on first run, or else we expire already scheduled updates
            clock.time++;
        clock.changes.run(applyDataChange);
        clock.updates.run(updateNode);
        clock.disposes.run(dispose);
        // if there are still changes after excessive batches, assume runaway            
        if (count++ > 1e5) {
            throw new Error("Runaway clock detected");
        }
    }
    RunningClock = running;
}
function applyDataChange(data) {
    data.value = data.pending;
    data.pending = NOTPENDING;
    if (data.log)
        markComputationsStale(data.log);
}
function markComputationsStale(log) {
    var node1 = log.node1, nodes = log.nodes;
    // mark all downstream nodes stale which haven't been already
    if (node1 !== null)
        markNodeStale(node1);
    if (nodes !== null) {
        for (var i = 0, len = nodes.length; i < len; i++) {
            markNodeStale(nodes[i]);
        }
    }
}
function markNodeStale(node) {
    var time = RootClock.time;
    if (node.age < time) {
        node.age = time;
        node.state = STALE;
        RootClock.updates.add(node);
        if (node.owned !== null)
            markOwnedNodesForDisposal(node.owned);
        if (node.log !== null)
            markComputationsStale(node.log);
    }
}
function markOwnedNodesForDisposal(owned) {
    for (var i = 0; i < owned.length; i++) {
        var child = owned[i];
        child.age = RootClock.time;
        child.state = CURRENT;
        if (child.owned !== null)
            markOwnedNodesForDisposal(child.owned);
    }
}
function updateNode(node) {
    if (node.state === STALE) {
        var owner = Owner, listener = Listener;
        Owner = Listener = node;
        node.state = RUNNING;
        cleanup(node, false);
        node.value = node.fn(node.value);
        node.state = CURRENT;
        Owner = owner;
        Listener = listener;
    }
}
function cleanup(node, final) {
    var source1 = node.source1, sources = node.sources, sourceslots = node.sourceslots, cleanups = node.cleanups, owned = node.owned, i, len;
    if (cleanups !== null) {
        for (i = 0; i < cleanups.length; i++) {
            cleanups[i](final);
        }
        node.cleanups = null;
    }
    if (owned !== null) {
        for (i = 0; i < owned.length; i++) {
            dispose(owned[i]);
        }
        node.owned = null;
    }
    if (source1 !== null) {
        cleanupSource(source1, node.source1slot);
        node.source1 = null;
    }
    if (sources !== null) {
        for (i = 0, len = sources.length; i < len; i++) {
            cleanupSource(sources.pop(), sourceslots.pop());
        }
    }
}
function cleanupSource(source, slot) {
    var nodes = source.nodes, nodeslots = source.nodeslots, last, lastslot;
    if (slot === -1) {
        source.node1 = null;
    }
    else {
        last = nodes.pop();
        lastslot = nodeslots.pop();
        if (slot !== nodes.length) {
            nodes[slot] = last;
            nodeslots[slot] = lastslot;
            if (lastslot === -1) {
                last.source1slot = slot;
            }
            else {
                last.sourceslots[lastslot] = slot;
            }
        }
    }
}
function dispose(node) {
    node.fn = null;
    node.log = null;
    cleanup(node, true);
}
