import { builder } from './builder';

// Concrete imports to prevent tree-shaking — each file registers types on the builder as a side effect
import { _registered as _image } from './types/image';
import { _registered as _position } from './types/position';
import { _registered as _season } from './types/season';
import { _registered as _team } from './types/team';
import { _registered as _club } from './types/club';
import { _registered as _teamsOnCompetitions } from './types/teamsOnCompetitions';
import { _registered as _competition } from './types/competition';
import { _registered as _playerTeamHistory } from './types/playerTeamHistory';
import { _registered as _player } from './types/player';
import { ContentStatusEnum } from './types/contentStatus';
import { ScoreTypeEnum } from './types/score';
import { _registered as _fixture } from './types/fixture';
import { _registered as _filters } from './filters';
import { _registered as _author } from './types/author';
import { _registered as _tagGroup } from './types/tagGroup';
import { _registered as _tag } from './types/tag';
import { _registered as _article } from './types/article';
import { _registered as _link } from './types/link';
import { _registered as _navigationItem } from './types/navigationItem';
import { _registered as _navigation } from './types/navigation';
import { _registered as _query } from './query/index';

// Reference imports to ensure they're not stripped
void [
  _image,
  _position,
  _season,
  _team,
  _club,
  _teamsOnCompetitions,
  _competition,
  _playerTeamHistory,
  _player,
  ContentStatusEnum,
  ScoreTypeEnum,
  _fixture,
  _filters,
  _author,
  _tagGroup,
  _tag,
  _article,
  _link,
  _navigationItem,
  _navigation,
  _query,
];

let _schema: ReturnType<typeof builder.toSchema> | null = null;

export function getSchema() {
  if (!_schema) {
    _schema = builder.toSchema();
  }
  return _schema;
}
