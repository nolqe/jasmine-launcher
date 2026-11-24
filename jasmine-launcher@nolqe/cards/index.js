// カードの登録。ここに足せば並び・表示切り替え・設定画面の対象になる（build は本体のメソッド名）
import {ParsecPart} from './parsec.js';
import {LauncherCardPart} from './launcher.js';
import {MusicPart} from './music.js';
import {PaseoPart} from './paseo.js';
import {SystemPart} from './system.js';
import {WebPanelPart} from './webpanel.js';
import {MemoryPart} from './memory.js';

export const CARDS = [
    {key: 'search', name: 'Launcher', build: '_buildSearch', part: LauncherCardPart},
    {key: 'music', name: 'Music', build: '_buildMusic', part: MusicPart},
    {key: 'system', name: 'System', build: '_buildSystem', part: SystemPart},
    {key: 'memory', name: 'Clean RAM', build: '_buildMemory', part: MemoryPart},
    {key: 'webpanel', name: 'Web', build: '_buildWebPanel', part: WebPanelPart},
    {key: 'parsec', name: 'Parsec', build: '_buildParsec', part: ParsecPart},
    {key: 'claude', name: 'Paseo', build: '_buildClaude', part: PaseoPart},
];
