/**
 * GhostLink i18n — Multi-language support.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from '../locales';
 *   <button>{t('send')}</button>
 *
 * Adding a language: create a new locale object and add to LOCALES map.
 */

export type Locale = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh' | 'ko' | 'pt';

interface LocaleStrings {
  // App
  app_name: string;
  loading: string;
  // Chat
  send: string;
  type_message: string;
  reply_to: string;
  edit: string;
  delete_msg: string;
  copy: string;
  pin: string;
  unpin: string;
  bookmark: string;
  read_aloud: string;
  react: string;
  show_more: string;
  show_less: string;
  // Agents
  agents: string;
  spawn_agent: string;
  kill_agent: string;
  online: string;
  offline: string;
  thinking: string;
  no_agents: string;
  // Settings
  settings: string;
  general: string;
  appearance: string;
  notifications: string;
  ai_providers: string;
  security: string;
  advanced: string;
  save: string;
  cancel: string;
  reset: string;
  // Channels
  channels: string;
  new_channel: string;
  // Search
  search: string;
  search_messages: string;
  no_results: string;
  // Common
  close: string;
  confirm: string;
  error: string;
  success: string;
  warning: string;
  // Workflow
  workflow: string;
  add_node: string;
  save_workflow: string;
}

const en: LocaleStrings = {
  app_name: 'GhostLink',
  loading: 'Loading...',
  send: 'Send',
  type_message: 'Type a message...',
  reply_to: 'Reply to',
  edit: 'Edit',
  delete_msg: 'Delete',
  copy: 'Copy',
  pin: 'Pin',
  unpin: 'Unpin',
  bookmark: 'Bookmark',
  read_aloud: 'Read aloud',
  react: 'React',
  show_more: 'Show more',
  show_less: 'Show less',
  agents: 'Agents',
  spawn_agent: 'Spawn Agent',
  kill_agent: 'Kill Agent',
  online: 'Online',
  offline: 'Offline',
  thinking: 'Thinking...',
  no_agents: 'No agents registered',
  settings: 'Settings',
  general: 'General',
  appearance: 'Appearance',
  notifications: 'Notifications',
  ai_providers: 'AI Providers',
  security: 'Security',
  advanced: 'Advanced',
  save: 'Save',
  cancel: 'Cancel',
  reset: 'Reset',
  channels: 'Channels',
  new_channel: 'New Channel',
  search: 'Search',
  search_messages: 'Search messages...',
  no_results: 'No results found',
  close: 'Close',
  confirm: 'Confirm',
  error: 'Error',
  success: 'Success',
  warning: 'Warning',
  workflow: 'Workflow',
  add_node: 'Add Node',
  save_workflow: 'Save Workflow',
};

const es: LocaleStrings = {
  app_name: 'GhostLink',
  loading: 'Cargando...',
  send: 'Enviar',
  type_message: 'Escribe un mensaje...',
  reply_to: 'Responder a',
  edit: 'Editar',
  delete_msg: 'Eliminar',
  copy: 'Copiar',
  pin: 'Fijar',
  unpin: 'Desfijar',
  bookmark: 'Marcador',
  read_aloud: 'Leer en voz alta',
  react: 'Reaccionar',
  show_more: 'Ver más',
  show_less: 'Ver menos',
  agents: 'Agentes',
  spawn_agent: 'Crear Agente',
  kill_agent: 'Eliminar Agente',
  online: 'En línea',
  offline: 'Desconectado',
  thinking: 'Pensando...',
  no_agents: 'Sin agentes registrados',
  settings: 'Configuración',
  general: 'General',
  appearance: 'Apariencia',
  notifications: 'Notificaciones',
  ai_providers: 'Proveedores IA',
  security: 'Seguridad',
  advanced: 'Avanzado',
  save: 'Guardar',
  cancel: 'Cancelar',
  reset: 'Restablecer',
  channels: 'Canales',
  new_channel: 'Nuevo Canal',
  search: 'Buscar',
  search_messages: 'Buscar mensajes...',
  no_results: 'Sin resultados',
  close: 'Cerrar',
  confirm: 'Confirmar',
  error: 'Error',
  success: 'Éxito',
  warning: 'Advertencia',
  workflow: 'Flujo de trabajo',
  add_node: 'Agregar Nodo',
  save_workflow: 'Guardar Flujo',
};

const fr: LocaleStrings = {
  app_name: 'GhostLink', loading: 'Chargement...', send: 'Envoyer', type_message: 'Tapez un message...',
  reply_to: 'Répondre à', edit: 'Modifier', delete_msg: 'Supprimer', copy: 'Copier', pin: 'Épingler',
  unpin: 'Désépingler', bookmark: 'Signet', read_aloud: 'Lire à voix haute', react: 'Réagir',
  show_more: 'Voir plus', show_less: 'Voir moins', agents: 'Agents', spawn_agent: 'Créer Agent',
  kill_agent: 'Supprimer Agent', online: 'En ligne', offline: 'Hors ligne', thinking: 'Réflexion...',
  no_agents: 'Aucun agent enregistré', settings: 'Paramètres', general: 'Général', appearance: 'Apparence',
  notifications: 'Notifications', ai_providers: 'Fournisseurs IA', security: 'Sécurité', advanced: 'Avancé',
  save: 'Enregistrer', cancel: 'Annuler', reset: 'Réinitialiser', channels: 'Canaux', new_channel: 'Nouveau Canal',
  search: 'Rechercher', search_messages: 'Rechercher des messages...', no_results: 'Aucun résultat',
  close: 'Fermer', confirm: 'Confirmer', error: 'Erreur', success: 'Succès', warning: 'Avertissement',
  workflow: 'Flux de travail', add_node: 'Ajouter Nœud', save_workflow: 'Enregistrer Flux',
};

const de: LocaleStrings = {
  app_name: 'GhostLink', loading: 'Laden...', send: 'Senden', type_message: 'Nachricht eingeben...',
  reply_to: 'Antwort an', edit: 'Bearbeiten', delete_msg: 'Löschen', copy: 'Kopieren', pin: 'Anheften',
  unpin: 'Lösen', bookmark: 'Lesezeichen', read_aloud: 'Vorlesen', react: 'Reagieren',
  show_more: 'Mehr anzeigen', show_less: 'Weniger', agents: 'Agenten', spawn_agent: 'Agent erstellen',
  kill_agent: 'Agent beenden', online: 'Online', offline: 'Offline', thinking: 'Denkt nach...',
  no_agents: 'Keine Agenten registriert', settings: 'Einstellungen', general: 'Allgemein', appearance: 'Darstellung',
  notifications: 'Benachrichtigungen', ai_providers: 'KI-Anbieter', security: 'Sicherheit', advanced: 'Erweitert',
  save: 'Speichern', cancel: 'Abbrechen', reset: 'Zurücksetzen', channels: 'Kanäle', new_channel: 'Neuer Kanal',
  search: 'Suchen', search_messages: 'Nachrichten suchen...', no_results: 'Keine Ergebnisse',
  close: 'Schließen', confirm: 'Bestätigen', error: 'Fehler', success: 'Erfolg', warning: 'Warnung',
  workflow: 'Arbeitsablauf', add_node: 'Knoten hinzufügen', save_workflow: 'Ablauf speichern',
};

const ja: LocaleStrings = {
  app_name: 'GhostLink', loading: '読み込み中...', send: '送信', type_message: 'メッセージを入力...',
  reply_to: '返信先', edit: '編集', delete_msg: '削除', copy: 'コピー', pin: 'ピン留め',
  unpin: 'ピン解除', bookmark: 'ブックマーク', read_aloud: '読み上げ', react: 'リアクション',
  show_more: 'もっと見る', show_less: '折りたたむ', agents: 'エージェント', spawn_agent: 'エージェント作成',
  kill_agent: 'エージェント停止', online: 'オンライン', offline: 'オフライン', thinking: '考え中...',
  no_agents: 'エージェントなし', settings: '設定', general: '一般', appearance: '外観',
  notifications: '通知', ai_providers: 'AIプロバイダー', security: 'セキュリティ', advanced: '詳細',
  save: '保存', cancel: 'キャンセル', reset: 'リセット', channels: 'チャンネル', new_channel: '新規チャンネル',
  search: '検索', search_messages: 'メッセージを検索...', no_results: '結果なし',
  close: '閉じる', confirm: '確認', error: 'エラー', success: '成功', warning: '警告',
  workflow: 'ワークフロー', add_node: 'ノード追加', save_workflow: 'ワークフロー保存',
};

const zh: LocaleStrings = {
  app_name: 'GhostLink', loading: '加载中...', send: '发送', type_message: '输入消息...',
  reply_to: '回复', edit: '编辑', delete_msg: '删除', copy: '复制', pin: '置顶',
  unpin: '取消置顶', bookmark: '收藏', read_aloud: '朗读', react: '回应',
  show_more: '展开', show_less: '收起', agents: '代理', spawn_agent: '创建代理',
  kill_agent: '终止代理', online: '在线', offline: '离线', thinking: '思考中...',
  no_agents: '无注册代理', settings: '设置', general: '常规', appearance: '外观',
  notifications: '通知', ai_providers: 'AI提供商', security: '安全', advanced: '高级',
  save: '保存', cancel: '取消', reset: '重置', channels: '频道', new_channel: '新频道',
  search: '搜索', search_messages: '搜索消息...', no_results: '无结果',
  close: '关闭', confirm: '确认', error: '错误', success: '成功', warning: '警告',
  workflow: '工作流', add_node: '添加节点', save_workflow: '保存工作流',
};

const ko: LocaleStrings = {
  app_name: 'GhostLink', loading: '로딩 중...', send: '보내기', type_message: '메시지 입력...',
  reply_to: '답장', edit: '수정', delete_msg: '삭제', copy: '복사', pin: '고정',
  unpin: '고정 해제', bookmark: '북마크', read_aloud: '읽어주기', react: '반응',
  show_more: '더 보기', show_less: '접기', agents: '에이전트', spawn_agent: '에이전트 생성',
  kill_agent: '에이전트 종료', online: '온라인', offline: '오프라인', thinking: '생각 중...',
  no_agents: '등록된 에이전트 없음', settings: '설정', general: '일반', appearance: '모양',
  notifications: '알림', ai_providers: 'AI 제공자', security: '보안', advanced: '고급',
  save: '저장', cancel: '취소', reset: '초기화', channels: '채널', new_channel: '새 채널',
  search: '검색', search_messages: '메시지 검색...', no_results: '결과 없음',
  close: '닫기', confirm: '확인', error: '오류', success: '성공', warning: '경고',
  workflow: '워크플로', add_node: '노드 추가', save_workflow: '워크플로 저장',
};

const pt: LocaleStrings = {
  app_name: 'GhostLink', loading: 'Carregando...', send: 'Enviar', type_message: 'Digite uma mensagem...',
  reply_to: 'Responder a', edit: 'Editar', delete_msg: 'Excluir', copy: 'Copiar', pin: 'Fixar',
  unpin: 'Desfixar', bookmark: 'Favorito', read_aloud: 'Ler em voz alta', react: 'Reagir',
  show_more: 'Ver mais', show_less: 'Ver menos', agents: 'Agentes', spawn_agent: 'Criar Agente',
  kill_agent: 'Encerrar Agente', online: 'Online', offline: 'Offline', thinking: 'Pensando...',
  no_agents: 'Nenhum agente registrado', settings: 'Configurações', general: 'Geral', appearance: 'Aparência',
  notifications: 'Notificações', ai_providers: 'Provedores IA', security: 'Segurança', advanced: 'Avançado',
  save: 'Salvar', cancel: 'Cancelar', reset: 'Redefinir', channels: 'Canais', new_channel: 'Novo Canal',
  search: 'Buscar', search_messages: 'Buscar mensagens...', no_results: 'Sem resultados',
  close: 'Fechar', confirm: 'Confirmar', error: 'Erro', success: 'Sucesso', warning: 'Aviso',
  workflow: 'Fluxo de trabalho', add_node: 'Adicionar Nó', save_workflow: 'Salvar Fluxo',
};

const LOCALES: Record<Locale, LocaleStrings> = { en, es, fr, de, ja, zh, ko, pt };

let _currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  if (locale in LOCALES) {
    _currentLocale = locale;
  }
}

export function getLocale(): Locale {
  return _currentLocale;
}

export function getAvailableLocales(): { code: Locale; name: string }[] {
  return [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'ja', name: '日本語' },
    { code: 'zh', name: '中文' },
    { code: 'ko', name: '한국어' },
    { code: 'pt', name: 'Português' },
  ];
}

export function t(key: keyof LocaleStrings): string {
  return LOCALES[_currentLocale]?.[key] || LOCALES.en[key] || key;
}
