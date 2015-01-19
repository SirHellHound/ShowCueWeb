var $audio;
var $userConfig;
var $library;
var $rootScope;

function CueConfig()
{
}

CueConfig.prototype.type = null;
CueConfig.prototype.persist = function persist() {
  var c = { type: this.type };
  this.extendedProperties.forEach(function (key) {
    c[key] = angular.copy(this[key]);
  }, this);
  return c;
};

CueConfig.prototype.thaw = function thaw(v) {
  this.extendedProperties.forEach(function (key) {
    if (v[key] != null) this[key] = v[key];
  }, this);
};

AudioCueConfig.prototype = new CueConfig();
AudioCueConfig.prototype.constructor = AudioCueConfig;
AudioCueConfig.prototype.type = 'audio';
AudioCueConfig.prototype.extendedProperties = ['gain','allowOverlap','loop','range','delay'];
function AudioCueConfig()
{
  CueConfig.prototype.constructor.apply(this);  
  this.gain = null;
  this.delay = null;
  this.range = [null, null];
  this.loop = [null, null];
  this.allowOverlap = false;
}

AudioControlCueConfig.prototype = new CueConfig();
AudioControlCueConfig.prototype.constructor = AudioControlCueConfig;
AudioControlCueConfig.prototype.type = 'audio-control';
AudioControlCueConfig.prototype.extendedProperties = ['waitActive','killActive','killAll','fadeTo','fadeRange'];
function AudioControlCueConfig()
{
  CueConfig.prototype.constructor.apply(this);  
  this.waitActive = false;
  this.killActive = false;
  this.killAll = false;
  this.fadeTo = null;
  this.fadeRange = [null, null];
}

CueConfig.thawItems = function thawItems(values) {
  return StageCue.thawItemsByType(values, [AudioCueConfig, AudioControlCueConfig]);
};

Channel.prototype.type = null;
function Channel()
{
  this.id = Math.floor((1 + Math.random()) * 0x100000000).toString(16).substring(1);
  this.name = 'Ch';
}

Channel.prototype.persist = function persist() {
  return { name: this.name, type: this.type };
};
Channel.prototype.thaw = function thaw(v) {
  this.name = v.name;
};

AudioChannel.prototype = new Channel();
AudioChannel.prototype.constructor = AudioChannel;
AudioChannel.prototype.type = 'audio';
function AudioChannel()
{
  Channel.prototype.constructor.apply(this);  
}

HtmlChannel.prototype = new Channel();
HtmlChannel.prototype.constructor = HtmlChannel;
HtmlChannel.prototype.type = 'html';
function HtmlChannel()
{
  Channel.prototype.constructor.apply(this);  
}

Channel.thawItems = function thawItems(values) {
  return StageCue.thawItemsByType(values, [AudioChannel, HtmlChannel]);
};

Cue.GO_NORMAL = 0;
Cue.GO_WITH_NEXT = 1;
Cue.GO_AFTER_THIS = 2;

function Cue(channelCount)
{
  if (channelCount == null)
    channelCount = 0;
  this.items = [];
  this.configs = [];
  for (var i = 0; i < channelCount; i++)
    this.addChannel();
  this.description = 'New Cue';
  this.goMode = Cue.GO_NORMAL;
}

Cue.prototype.persist = function persist() {
  var r = { 
    description: this.description,
    goMode: this.goMode,
    items: this.items.map(function (i) { return i instanceof LibraryItem ? { id: i.id } : {}; }),
    configs: this.configs.map(function (i) { return i instanceof CueConfig ? i.persist() : {}; }),
  };
  return r;
};

Cue.prototype.thaw = function thaw(v, libraryItemMap) {  
  if (v.description != null)
    this.description = v.description;
  if (v.goMode != null)
    this.goMode = v.goMode;
  if (libraryItemMap !== undefined)
    this.items = v.items.map(function (i) { return libraryItemMap[i.id] || {} });
  this.configs = CueConfig.thawItems(v.configs);
};

Cue.prototype.addChannel = function addChannel()
{
  this.items.push({});
  this.configs.push({});
};

Cue.prototype.channelReordered = function channelReordered(x, y)
{
  var a = this.items[y];
  var b = this.items[x];
  this.items[y] = {};
  this.items[x] = a;
  this.items[y] = b;
  this.itemReordered(x, y);
};

Cue.prototype.itemReordered = function itemReordered(x, y)
{
  var a = this.configs[y];
  var b = this.configs[x];
  this.configs[y] = {};
  this.configs[x] = a;
  this.configs[y] = b;
};

Cue.prototype.setItem = function setItem(channelIndex, item)
{
  if (channelIndex < 0 || channelIndex >= this.items.length) return;
  this.items[channelIndex] = item;
  var configs = CueConfig.thawItems([{type: item.type}]);
  this.configs[channelIndex] = configs[0];
};

Cue.prototype.removeChannelAt = function removeChannelAt(index)
{
  if (index < 0 || index >= this.items.length) return;
  this.items.splice(index, 1);
  this.configs.splice(index, 1);
};

function CueEngine(audio, userConfig, library, rootScope)
{
  $library = library;
  $audio = audio;
  $userConfig = userConfig;
  $rootScope = rootScope;
  userConfig.onPersist('cueEngine', this.persist, this);
  userConfig.onThaw('cueEngine', this.thaw, this);

  this.current = -1;
  this.running = false;
  this.runningEra = 0;
  this.cues = [];
  this.channels = [];
  this.loaded = false;
  this.addChannel(new AudioChannel());
}

CueEngine.prototype.addChannel = function addChannel(channel)
{
  if (this.running) return;
  channel.name = 'Ch ' + this.channels.length;
  this.channels.push(channel);
  
  $audio.addChannel(channel);

  this.cues.forEach(function (cue) {
    cue.addChannel();
  });
  this.flush();
};

CueEngine.prototype.removeChannelAt = function removeChannelAt(index)
{
  if (this.running) return;
  var channels = this.channels.splice(index, 1);
  var channel = channels[0];

  $audio.removeChannel(channel);

  this.cues.forEach(function (cue) {
    cue.removeChannelAt(index);
  });
  this.flush();
};

CueEngine.prototype.channelReordered = function channelReordered(x, y)
{
  if (this.running) return;
  this.cues.forEach(function (cue) {
    cue.channelReordered(x, y);
  });
  this.flush();
};

CueEngine.prototype.addCue = function addCue(item)
{
  if (this.running) return;
  var cue = new Cue(this.channels.length);
  cue.description = item.name;
  this.cues.push(cue);
  if (item != null)
    cue.setItem(0 /* First matching channel? */, item);
  if (this.cues.length == 1)
    this.current = 0;
  this.flush();
  return cue;
};

CueEngine.prototype.removeCueAt = function removeCueAt(index)
{
  if (this.running) return;
  if (index < 0 || index >= this.cues.length) return;
  this.cues.splice(index, 1);
  if (this.current >= this.cues.length)
    this.current--;
  this.flush();
};

CueEngine.prototype.moveCueAt = function moveCueAt(index, offset)
{
  if (this.running) return;
  if (index < 0 || index >= this.cues.length) return;
  if (index + offset < 0) return;
  if (index + offset >= this.cues.length) return;
  if (offset > 1) offset--;
  var removed = this.cues.splice(index, 1);
  this.cues.splice(index + offset, 0, removed[0]);
  this.current = index + offset;
  this.flush();
};

CueEngine.prototype.duplicateCue = function duplicateCue()
{
  if (this.running) return;
  var index = this.current;
  if (index < 0 || index >= this.cues.length) return;

  var data = this.cues[index].persist();
  var libraryItemMap = this.getLibraryItemMap();

  var newCue = new Cue(); 
  newCue.thaw(data, libraryItemMap); 
  this.cues.splice(index, 0, newCue);
};

CueEngine.prototype.removeCueItemAt = function removeCueItemAt(cueIndex, index)
{
  if (this.running) return;
  if (cueIndex < 0 || cueIndex >= this.cues.length) return;
  this.cues[cueIndex].setItem(index, {});
  this.flush();
};

CueEngine.prototype.setCurrentAt = function setCurrentAt(index)
{
  if (index < 0 || index >= this.cues.length) return;
  this.current = index;
};

CueEngine.prototype.go = function go()
{
  do 
  {
    var cue = 
      (function() {
        if (this.running) this.current++;
        if (this.current < 0 || this.current >= this.cues.length)
        {
          if (this.running) {
            this.softStop();
            this.current = 0;
          }
          return;
        }
        this.running = true;
        var era = ++this.runningEra;
        this.runningItemCount = 0;

        var cueEngine = this;

        var cue = this.cues[this.current];
        for (var i = 0; i < cue.items.length; i++)
        {
          var item = cue.items[i];
          if (item instanceof AudioItem || item instanceof AudioControlItem) {
            this.runningItemCount++;
            $audio.go(this.channels[i], item, cue.configs[i])
              .then(function() { cueEngine.cueItemEndCallback(cue, era); });
          }
        }
        return cue;
      }).call(this);
  } while (cue && cue.goMode == Cue.GO_WITH_NEXT);
};

CueEngine.prototype.cueItemEndCallback = function cueItemEndCallback(cue, era)
{
  if (era == this.runningEra)
  {
    if (--this.runningItemCount <= 0)
    {
      if (cue.goMode == Cue.GO_AFTER_THIS) {
        this.go();
      } else {
        this.softStop();
      }
    }
  }
};

CueEngine.prototype.softStop = function softStop()
{
  this.runningEra++;
  if (!this.running) return;
  this.running = false;
  if (this.current < this.cues.length - 1) this.current++; else this.current=0;
};

CueEngine.prototype.stop = function stop()
{
  this.softStop();
  for (var i = 0; i < this.channels.length; i++)
  {
    var channel = this.channels[i];
    if (channel instanceof AudioChannel) {
      $audio.stop(channel);
    }
  }
};

CueEngine.prototype.flush = function flush()
{
  if (!this.loaded) return
  $userConfig.raiseDirty('cueEngine');
}

CueEngine.prototype.persist = function persist() {
  var result =
    {
      channels: this.channels.map(function (i) { return i.persist(); }),
      cues: this.cues.map(function (i) { return i.persist(); })
    };
  return result;
};

CueEngine.prototype.thaw = function thaw(v)
{
  this.loaded = true;
  if (v == null) return;

  var libraryItemMap = this.getLibraryItemMap();

  this.channels.splice(0);
  this.cues.splice(0);
  var newChannels = Channel.thawItems(v.channels);
  this.channels.push.apply(this.channels, newChannels);
  for (var i = 0; i < newChannels.length; i++)
  {
    var channel = newChannels[i];
    $audio.addChannel(channel);
  }
  this.cues.push.apply(this.cues, v.cues.map(function (i) {
    var item = new Cue(); 
    item.thaw(i, libraryItemMap); 
    return item; 
  }));
  this.setCurrentAt(0);
};

CueEngine.prototype.getLibraryItemMap = function getLibraryItemMap(v)
{
  var libraryItemMap = [];
  $library.items.forEach(function (i) { libraryItemMap[i.id] = i; });
  return libraryItemMap;
}

angular.module("stageCue").service("sc.cueEngine", ['sc.audio', 'sc.userConfig', 'sc.library', '$rootScope', CueEngine]);
