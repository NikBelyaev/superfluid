# Superfluid: UI/UX review against T3 Code

Дата: 5 ноября 2026. Независимое ревью перед визуальной переработкой. Реализация в этом проходе не менялась.

## Вывод

Главная проблема — не отсутствие «красивого шрифта». На macOS оба приложения начинают font stack с `-apple-system`, то есть используют системный UI face. Superfluid уменьшает основной интерфейс до 10–11 px, дробит поверхности множеством немного разных серо-синих цветов и рамок и повторяет одну ветку в шести местах. Результат выглядит как уменьшенный IDE chrome, а не спокойный T3 UI.

Нужна одна согласованная типографическая шкала, нейтральный светлый canvas, обычный читаемый foreground, единая геометрия контролов и меньше повторов. Переносить всю архитектуру T3 или добавлять декоративные эффекты не требуется.

Основания: просмотрены реальные `test-results/workspace.png` и `test-results/changes.png` (1512×980), исходные референсы пользователя из истории задачи, Superfluid CSS/компоненты и локальные исходники T3. T3 приложение в этом ревью не запускалось; точное пользовательское состояние Appearance неизвестно. Приведённые ниже фрагменты взяты из исходников, а не восстановлены по картинке.

## Критерии и исходные оценки

Оценки — текущему Superfluid до правок. Порог готовности визуального прохода — 8/10 по каждому критерию. Целевые оценки нельзя считать достигнутыми до повторного просмотра реального Electron.

| Критерий | Сейчас | Конкретное основание | Что доведёт до ≥8 |
|---|---:|---|---|
| Читаемая типографика | 4 | Island11px, run metadata9px, surface tabs10px, controls/menu11px; обычное действие меньше кода | Основные UI действия13–14px, secondary12px, редкие metadata11px; один stack и веса400/500/600 |
| Соответствие визуальному языку T3 | 5 | Голубоватые chrome/selection/icons; отдельные tab styles слева и справа | T3 neutral zinc tokens, tab recipe, island row recipe и icon stroke |
| Иерархия и отсутствие шума | 5 | Ветка повторяется header/strip/tree/island heading/Gitrow/status; много параллельных horizontal rules | WT strip остаётся основным переключателем; убраны лишние повторы и sidebar footer |
| Геометрия и консистентность | 5 | Случайные heights25/26/29/31/33/35/39/41, радиусы3–13px и веса550/560/580/620/650 | Семейства24/28/32px, content row28px, toolbar40px, icon16px, радиусы4/6/8/16 |
| Рабочая поверхность IDE | 6 | Остров перекрывает редактор; при маленьком окне фиксированная ширина и длинный список отнимают место; code13/terminal12/diff defaults разнятся | Ограниченная высота острова/скролл и компактное сворачивание, одна code typography, ясный active editor/tab |
| Управление и обратная связь | 6 | Native `details` Git menu не даёт стандартной menu navigation; действия скрываются opacity; незаметное выбранное состояние | Base UI menu keyboard/focus/outside dismissal, hover и focus одинаково раскрывают controls, ясные selected/pending states |
| Доступность и контраст | 5 | `#8a93a0` на белом3.11:1; run metadata `#8d96a2`2.99:1 при9px; часть иконок12–13px | Normal text ≥4.5:1, main controls≥24px hit area, keyboard/focus и full labels в tooltip |
| Сохранение отзывчивости | 8 | Canvas terminal и Monaco не гонят текст в React; worker diff; UI почти без анимаций | Сохранить lifecycle и caps; не добавлять blur/spring/re-render на ввод; проверить ту же e2e |

## Диагноз по поверхностям

### Типографика

- `apps/web/src/style.css:1`: root13px; при этом почти весь CSS задаёт собственные10/11/12px. Изменить только root недостаточно.
- `style.css:984`: island row11px против буквального T3 `text-[13px] font-medium`; подпись процесса9px вместо нормального secondary12px. В результате важные Run/Git/Stop визуально слабее технических деталей редактора.
- `style.css:1172`: right tabs10px; T3 right tab recipe — `text-xs` (12px при16px root). Left tabs11px имеют другую форму и underline.
- Controls форм11–12px, menu11px, launcher12px; T3 desktop recipes используют `sm:text-sm` (14px при16px root). Не переносить `sm:*` как особый режим macOS: в T3 это responsive breakpoint.
- `Editor.tsx:205`: SFMono-Regular,13/22; `Terminal.tsx:25–26,41`: похожий stack,12px; diff не получает общих font custom properties. Для IDE предложить code14/22, terminal13px с метриками по этому размеру, diff13px; это **адаптация для IDE**, не подтверждённый T3 default code size.
- Веса550/560/580/620 в нынешнем CSS не формируют ясной роли. При системном font некоторые интерполируются, но это не основание использовать шесть уровней. Достаточно400 body,500 controls,600 heading.
- T3 импортирует `@fontsource-variable/inter`, но ставит его после системных Apple faces. Добавление Inter не изменит macOS UI само по себе. Не скачивать новый font ради этого прохода. Если нужна идентичная типографика вне Apple позже — локально bundle Inter с его OFL лицензией.

### Палитра, borders, icons

- Нынешние `#f3f5f8`, `#f6f7f9`, `#fafbfc`, `#e1e9f4`, `#5478a4`, `#8998aa` создают постоянный синий оттенок и слишком много почти одинаковых surface levels. В T3 базовый light shell нейтрален: zinc25/50/100, zinc900 foreground, zinc500 secondary.
- Не сделать весь интерфейс светло-серым текстом. Quiet UI получается от малого числа акцентов и поверхности, а не от снижения контраста всего текста.
- Основной icon16px; редкие12px только badge/close glyph, сохраняя24px hit area. T3 Lucide stroke1.75; у нас глобальный1.65 и множество size12/13 делают иконки тусклыми. Ограничить правило Lucide, не всем SVG (не менять chart/brand SVG).
- Сейчас 3px `.resize-handle` выглядит как дополнительная полоса. Сделать видимый separator1px, hit region5–7px псевдоэлементом; hover/focus accent. Не уменьшать интерактивную область до1px.
- Не нужны тени у каждой постоянной панели. T3 island может иметь border/radius и чистое содержимое; overlay menu/modal — единственная оправданная elevation. Наша island shadow небольшая, её сила не главный дефект.

### Chrome, worktree и дерево

- Сохранить WT strip постоянно: это преимущество IDE. Несколько worktree нельзя прятать только в dropdown.
- Оставить project switcher в titlebar, WT strip с NewWT, current branch в Git-секции острова. Убрать branch selector/NewWT из titlebar, branch suffix tree-root, branch/sidebar footer и ветку statusbar. Git context остаётся очевиден в strip+island.
- Expanded island-heading сейчас ещё раз пишет `main`. Удалить отдельную39px строку; collapse разместить рядом с Scripts actions. В collapsed состоянии оставить ветку+expand. Не заменять повтор содержимого новой декоративной надписью.
- Left/right tabs должны иметь одинаковую типографику12px,24px pill,6px radius; toolbar row40px. На активной вкладке спокойная neutral fill, foreground; hover close только для неактивных вкладок, но также на `:focus-within`. Main editor может сохранять отдельную edge line, но не одновременно full bordered boxes+blue underline.
- Tree row28px оставить: компактность здесь уместна. Текст13px, icons16px, indent12px, спокойная нейтральная selected fill; dirty status остаётся отдельным семантическим цветом. Root row не повторяет branch. Не копировать AI-thread sidebar T3 в file tree.

### Остров

- Width280px (близко к T3 `--thread-details-panel-width:17.5rem`), outer radius16px, white/nearwhite, one neutral border. Sections8px horizontal inset, row inner10px, gap10px, row32px. Заголовок секции11px/16, normal secondary; rows13px/20 weight500, process metadata12px/16 weight400.
- Не весь текст font-medium: только action labels. Running/exited/shortcut secondary400.
- Ограничить max-height по editor viewport и сделать внутренний scroll с фиксированно доступным collapse. На узком editor скрывать подробный список по явному collapse, не увеличивать автоматически overlaid площадь. Не позволять острову перекрывать весь viewport; минимум180px видимой ширины editor не означает, что258px island туда помещается.
- Git split control: единая32px строка; secondary chevron32px, separator появляется только hover/open, как в T3. Это убирает три конкурирующие маленькие цели внутри одного action.
- Native `details` заменить маленьким Base UI Menu: Escape, стрелки, Enter, outside click, focus return и collision positioning. Base UI уже установлен. Копировать семантику T3 menu, а не добавлять новую библиотеку.

### Правые поверхности, PR, формы, empty states

- Launcher: ширина max320px, primary14px,32px row, gap10px, icons16px, kbd12px/20. Обычный текст foreground, secondary muted. Никакого крупного decorative logo/карточки.
- Diff: общий mono stack и custom properties проходят через Shadow DOM Pierre; toolbar labels12–13px. Не пробовать стилизовать `.view-lines` diff обычным внешним CSS.
- PR Summary/Timeline/Code: единый segmented container (T3 ToggleGroup) вместо трёх разрозненных маленьких серых кнопок. Metadata12px, title16/24 weight600, body14/22; current `.markdown`12px line-height1.85 выглядит мелко и рыхло одновременно. 16px content padding как T3. Не внедрять новые GitHub features ради визуального прохода.
- Forms: label13px, description14/20, hint12/18; field14px/32px (textarea line20px), button14px/32px, title20/28. Важные ошибки13px с readable contrast. Dialog radius16px, neutral border, один restrained shadow. Не переносить T3 glass/blur/nested scale effects.
- Welcome: сохранить понятный recent-project list, отказаться от Georgia italic `s` как случайного substitute-logo. Использовать простой existing mark/wordmark без нового декоративного языка. Project title14px, path12px, row64px, controls14px/32px. Welcome не должен иметь свой отдельный оттенок selection/button.
- Empty states: title14px/20 weight500, body13px/20, один конкретный next action. Не уменьшать текст до10–11px ради «чистоты». Loading/error те же spacing и text roles.

## Готовые исходные фрагменты T3 для переноса

Все пути в этом разделе относительно T3 checkout `/tmp/superfluid-t3-reference-20261105`, подтверждённый HEAD **`337c5858c33bc7f8f6dfd391a2c279fa0f7e4d17`**. T3 LICENSE: **MIT, Copyright (c) 2026 T3 Tools Inc.** При копировании сохранить MIT notice в `THIRD_PARTY_NOTICES.md` и ссылку на точные source paths/SHA. Следующие блоки **Original T3** буквальны; блоки **Adaptation** предложены для Superfluid. Snippets на Tailwind нельзя просто вставить в обычный CSS: нужен эквивалент CSS или используемый в проекте utility pipeline. Добавлять Tailwind/CVA только ради нескольких стилей не требуется.

### A. Общие font stacks и Pierre hooks

**Original T3 — `apps/web/src/appearanceFonts.ts:13–18`:**

```ts
export const DEFAULT_SANS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif';

// Some engines map `ui-monospace` to a proportional font, so prefer concrete names.
export const DEFAULT_CODE_FONT_STACK =
  '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
```

**Original T3 — `apps/web/src/index.css:1808–1811`:**

```css
:root {
  --diffs-font-family: var(--font-mono);
  --diffs-header-font-family: var(--font-sans);
}
```

**Adaptation:** literal stacks как общие `--font-sans/--font-mono`; Monaco `fontFamily` и Canvas font получают тот же mono token. Для Monaco и Canvas размеры остаются в px, чтобы root16px не масштабировал их второй раз. `--diffs-font-size:13px`. До изменения terminal font убедиться, что `measureGhosttyCell`, rendering и PTY cols/rows используют один размер; просто CSS font Canvas не меняет. T3 smoothing включается настройкой в `appearanceFonts.ts:100–104`, это не доказанный безусловный default. Не приписывать ему магическое качество нового шрифта.

### B. Light tokens

**Original T3 — `apps/web/src/index.css:1125–1138` и `1145–1146`:**

```css
--foreground: var(--color-zinc-900);
--card: var(--color-white);
--card-foreground: var(--color-zinc-900);
--popover: var(--color-white);
--popover-foreground: var(--color-zinc-900);
--primary: oklch(0.488 0.217 264);
--primary-foreground: var(--color-white);
--secondary: var(--color-zinc-50);
--secondary-foreground: var(--color-zinc-800);
--muted: var(--color-zinc-50);
--muted-foreground: var(--color-zinc-500);
--placeholder: var(--muted-foreground);
--secondary-label: var(--muted-foreground);
--icon-muted: var(--muted-foreground);
```

```css
--accent: var(--color-zinc-100);
--accent-foreground: var(--color-zinc-900);
```

Другие source roles: border=zinc200 (`:1152`), input=zinc300 (`:1153`), sidebar=zinc50 (`:1171`), sidebar-row-active/selected=white (`:1176–1177`), background=`--color-zinc-25` (`:1116`), zinc25=`oklch(99.2% 0 0)` (`:222`).

**Adaptation:** использовать эквивалентные нейтральные значения без Tailwind dependency: foreground `#18181b`, secondary foreground `#27272a`, muted `#71717a`, shell/sidebar `#fafafa`, accent `#f4f4f5`, border `#e4e4e7`, input `#d4d4d8`, card/popover `#fff`, canvas `oklch(99.2% 0 0)`. Это удобные CSS equivalents; original T3 tokens остаются источником роли, не утверждением об identical color conversion всех OKLCH. Accent для действия/фокуса — буквальный T3 primary. Normal secondary zinc500 на white≈4.83:1, на zinc50≈4.63:1. Отдельно проверить muted на selected fill, не понижать opacity текста.

### C. Island row — основной reusable recipe

**Original T3 — `apps/web/src/components/chat/threadDetailsPanelStyles.ts:1–4,13,18–20,31–35`:**

```ts
const THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS = "bg-transparent shadow-none";

const THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS =
  "hover:!bg-black/[0.035] data-pressed:!bg-black/[0.035] dark:hover:!bg-white/[0.08] dark:data-pressed:!bg-white/[0.08]";

export const THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS = "gap-2.5 px-2.5 text-left";

const THREAD_DETAILS_PANEL_CONTROL_CLASS = `h-8 min-w-0 rounded-lg border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} text-[13px] font-medium text-foreground/80`;

export const THREAD_DETAILS_PANEL_ROW_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} w-full justify-start ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_ICON_CLASS = "size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_CHEVRON_CLASS = "size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_ICON_ACTION_CLASS = `size-6 justify-center rounded-md border-transparent bg-transparent p-0 sm:size-6 ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;
```

Пропущенная соединительная константа исходника (`:9`) — `${THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS} ${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS}`; не копировать snippet как автономный runnable module без неё.

**Adaptation — в `apps/web/src/style.css`:**

```css
.island-row {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
  text-align: left;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: color-mix(in srgb, var(--foreground) 80%, var(--card));
}
.island-row:hover,
.island-row[aria-expanded='true'] { background: rgb(0 0 0 / 3.5%); }
.island-row > svg { width: 16px; height: 16px; color: var(--muted-foreground); }
.island-row small { font-size: 12px; line-height: 16px; font-weight: 400; }
```

Для двухстрочного run добавить `padding-block:6px`, не сжимать text line-height, row может быть выше32px. Это улучшает читабельность без увеличения всех однострочных команд.

### D. Island sections/split control

**Original T3 — `ThreadDetailsSection.tsx:28–29,34,40`:**

```tsx
"px-2 pt-2 pb-2.5 has-[>div:last-child:empty]:hidden",
separated && "border-border/65 [section:not(:has(>div:last-child:empty))~&]:border-t",
```

```tsx
"mb-1 flex min-h-8 min-w-0 items-center justify-between gap-2 px-2.5",
```

```tsx
className="min-w-0 truncate text-2xs font-medium text-muted-foreground select-none"
```

**Original T3 — `threadDetailsPanelStyles.ts:39–47`:**

```ts
export const THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS = `group/details-split flex w-full items-center rounded-lg ${THREAD_DETAILS_PANEL_SPLIT_GROUP_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_PRIMARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} flex-1 justify-start rounded-e-none ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SECONDARY_CLASS = `${THREAD_DETAILS_PANEL_CONTROL_CLASS} w-8 justify-center rounded-s-none px-0 ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

// The split hairline shows only while the pair is in use, so resting rows read as plain rows.
export const THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS =
  "h-4 w-px shrink-0 bg-transparent group-hover/details-split:bg-border/65 group-has-[[data-popup-open]]/details-split:bg-border/65";
```

**Adaptation:** section padding8px 8px 10px; heading row≥28–32px, caption11px/16. Не добавлять section heading к Git: строки уже самоочевидны. Split32px+32px chevron, separator16px высоты только hover/open. `ThreadDetailsCard.tsx:118` даёт `rounded-2xl` (16px); берём геометрию, **не** `dropdown-glass`/blur и не T3 chat positioning/measuring machinery.

### E. Tabs, launcher, shortcuts

**Original T3 — `RightPanelTabs.tsx:1012–1016`:**

```tsx
"cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
props.ownsDesktopTitleBar && "[-webkit-app-region:no-drag]",
props.active
  ? "bg-accent text-foreground"
  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
```

**Original T3 — `RightPanelTabs.tsx:486,504`:**

```tsx
<h3 className="mb-3 text-center font-medium text-foreground text-sm">Open a surface</h3>
```

```tsx
"flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm transition-colors group-hover:bg-accent/60",
```

**Original T3 — `components/ui/kbd.tsx:9`:**

```tsx
"pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded bg-foreground/[0.07] px-1 font-medium font-sans text-muted-foreground text-xs [&_svg:not([class*='size-'])]:size-3",
```

**Adaptation:** shared main/side tab CSS12px, height24px pill, radius6px; toolbar40px (IDE-specific, T3 parent can own52px titlebar). Launcher14px/32px, kbd12px height20px. Берём presentation, сохраняем наши tab identities, document lifecycle и drag behavior. Не переносим DnD/provider state из1800-строчного RightPanelTabs.

### F. Buttons/menu/input/PR segmented

**Original T3 — `components/ui/button.tsx:17–20`:**

```ts
compact:
  "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
icon: "size-9 sm:size-8",
```

Button base (`:8`) использует `font-medium`, `sm:text-sm`, icon16px на desktop, focus ring; Input (`components/ui/input.tsx:23,68`) использует desktop inner30px + outerborder, `sm:text-sm`, radius8px. MenuItem (`components/ui/menu.tsx:132`) desktop `sm:min-h-7 sm:text-sm`, icon16px,8px inset. Эти длинные class strings лучше переводить в короткий локальный primitive, сохраняя существующий Base UI контракт, а не переносить внутренние T3 retention helpers.

**Original T3 — `components/ui/toggle-group.tsx:32–35`:**

```ts
variant === "segmented"
  ? "gap-0.5 rounded-lg bg-input/40 p-0.5"
  : variant === "default"
    ? "gap-0.5"
```

`PullRequestDetailLayout.tsx:86–90` использует этот ToggleGroup с `size="segmented" variant="segmented" value={[value]}`. Header metadata (`:31,38–39`) —12px, body horizontal inset16px (`:29`); nav (`:82`) —16px horizontal,8px vertical, один topborder60%.

**Adaptation:** локальная `.segmented` background=`input`40%,padding2px,gap2px,radius8px; кнопки14px,height24px,selectedwhite with subtle inset/border, не фоновать три независимые кнопки. Для честных tabs использовать role tablist/tab/tabpanel с arrow/focus behavior либо Base UI Tabs. В T3 этот control реализован как ToggleGroup, но наши Summary/Timeline/Code являются tabs по смыслу. Не добавлять CVA/Tailwind ради трёх кнопок.

**Original T3 — `index.css:1728–1731`:**

```css
@layer base {
  :where(svg.lucide[stroke-width="2"]) {
    stroke-width: 1.75;
  }
}
```

**Adaptation:** тот же scoped selector без ненужного layer, удалить нынешний общий `svg { stroke-width:1.65 }`.

## Точная таблица целевых значений

Значения ниже — согласованная спецификация для Superfluid. Там, где это адаптация IDE, это отмечено; не все значения объявлены T3 literal constants.

| Role / selector | Сейчас | После | Основание |
|---|---|---|---|
| root / body | root13px, no lineheight | root16px; body14px/20px | rem baseline для T3 recipes; primary desktop control14px |
| font stack | Apple/Segoe/no mono token | T3 stacks A | literal reuse |
| normal text | #29313c + множество variants | foreground zinc900 | B |
| secondary | #69717e…#a1aab7 | zinc500; не opacity text | B; contrast |
| shell/sidebar | #f3f4f6/#f6f7f9 | zinc50 | B |
| border | #e1e4e9 и десятки variants | zinc200; muted separators65% | B/D |
| action/focus | #245fdb | oklch(0.488 0.217 264) | B |
| titlebar |51px |52px, quiet neutral | T3 index.css:123 |
| worktree strip |38px,11px |36px,13px/20px, chip28px | IDE adaptation |
| tree row |28px,12px |28px,13px/20px, icon16px | IDE adaptation, geometry unchanged |
| main/side tabs |35pxstrip,11/10px, box/pill |40pxstrip,24pxpill,12px/16,6pxradius | E + IDE toolbar |
| breadcrumb |30px,10px |28px,12px/16; trim to file context | IDE adaptation |
| island |258pxwidth,radius13px |280px,16pxradius, bounded viewport height | T3 panelwidth17.5rem/cardrounded2xl |
| island rows |29px,11px |32px,13px/20,weight500 | C |
| island headings |22pxrow,10px |28–32pxrow,11px/16,weight500 | D |
| run metadata |9px |12px/16,400 | readable secondary adaptation |
| standard button/input |31/33px,11/12px |32px,14px/20,8pxradius | F |
| icon action |26px |28px toolbar;24px island | T3 icon-sm/icon-xs + C |
| menu item |11px |14px/20,28pxminheight,8pxinset | F |
| launcher |12px,row~32px |14px/20,row32px,gap10px | E |
| status |25px,10px |24px,11px/16, no branch duplicate | IDE metadata adaptation |
| PR body |12px/1.85 |14px/22px;title16px/24 | readable adaptation |
| modal title / description |17px/12px |20px/28px600 /14px/20 | T3 DialogTitle text-xl and descriptiontext-sm |
| modal label / hint |11px/10px |13px/20 /12px/18 | readable adaptation |
| code / terminal / diff |13px /12px /implicit |14px22 /13pxmeasured /13px | IDE adaptation; sharedfonttoken |

## Исполнимый план

### P0 — один визуальный язык и читаемость

1. **`style.css` tokens and foundations.** В начале файла задать font/color/space/radius/control/text roles из таблицы. Заменить существующие значения в правилах; не дописывать в конец третий слой overrides. Сохранить семантические success/error/warning, но нейтрализовать обычный chrome. Удалить случайные дробные weights и глобальный stroke. Новые зависимости не нужны.
2. **`Editor.tsx`, `Terminal.tsx`, `Surfaces.tsx`.** Подключить общий mono font и размеры. Canvas должен пересчитать metrics и grid для13px. Pierre hooks A должны наследоваться в shadow roots. Без изменений в ownership моделей/PTY/recovery.
3. **`Workspace.tsx`, `Tree.tsx`, `Island.tsx`, `style.css`.** Убрать branch duplicates перечисленные выше; сохранить WTstrip. Согласовать tabs, headers, tree, status. Expanded island без лишней header-row, новый rowrecipeC/D,16pxicons, boundedheight. Небольшой viewport не должен скрывать Stop/collapse за краем экрана.
4. **`Surfaces.tsx`, `Modal.tsx`, `Palette.tsx`, `App.tsx`, `style.css`.** По таблице выровнять launcher/PR/forms/welcome/palette. Никакого нового брендинга, новых flows или переписывания backend. Сохранить доступные названия действий и текущие keyboard shortcuts.
5. **`THIRD_PARTY_NOTICES.md`.** Дополнить заимствования точными путями/SHA, уже имеющийся MIT notice не потерять. Если CSS переведён из Tailwind — отметить adapted, не выдавать за дословную копию.

### P1 — поведение поверх согласованного UI

6. **Git menu.** В `Island.tsx` заменить `<details>` на доступный Base UI Menu (installed dependency), небольшая локальная стилизация по F. Arrow/Escape/Enter/outsideclose/focusreturn, без запроса пользователя/нового permission flow. Убедиться, что menu выше острова и не обрезается его scrollcontainer; использовать Portal.
7. **States.** `.quiet` visible на `:focus-within`, выбранныйtab/WT доступен не только цветом, pending action не меняет геометрию кнопки, longlabels ellipsis+tooltip. PR segmented имеет настоящую keyboard semantics. Resize separator визуально1px с сохранённым hit area.
8. **Проверка реального Electron и сравнение.** Сначала скриншоты одинаковых fixture/размеров, затем e2e и packagedapp; если критерий ниже8 — точечная правка именно этого mismatch, без добавления декоративных слоёв.

P0 и P1 являются одним завершённым UI проходом. P1 здесь — порядок работ, а не предложение отложить базовую keyboard-доступность.

## Что переносить, адаптировать и не переносить

| Решение | Действие |
|---|---|
| Sans/mono stacks, Pierre font hooks, light token roles, Lucide stroke | Перенести буквально или как прямой CSS equivalent |
| Island row/section/splitcontrol, tabs, kbd, menuitem/input/button geometry | Адаптировать utility classes в существующий CSS без нового styling stack |
| Base UI focus/menu interaction pattern | Переиспользовать underlying installed primitives, сохранить our domain handlers |
| T3 AI sidebar/thread controls/usage bar/Open in Cursor | Не переносить: другой продукт, не нужны для Python IDE |
| Glass/backdrop blur/nested dialog scale/surfacegrain/view transitions | Не переносить: не нужны для чистоты, усложняют paint/восприятие IDE |
| `ThreadDetailsCard` ChatCanvas positioning/density machinery | Не переносить целиком: IDE располагает собственной editor surface; взять boundedlayout principles |
| Whole RightPanelTabs/state/provider imports | Не переносить: нужны style recipe и tab behavior, не T3 runtime |
| Appearance customization/font discovery permissions | Не добавлять ради этого прохода; единые default tokens достаточны |

## Acceptance: как считать проход законченным

- [ ] До/после снимки одинакового fixture при1512×980 и100% zoom: welcome, editor+island, terminal, changesdiff, actiondialog, filepalette, PR Summary/Timeline/Code (достаточна локальная PRfixture, не публиковать реальный PR).
- [ ] Дополнительный snapshot1280×800: labels не обрезаются случайно, остров/collapse/Stop доступны; rightpanel можно закрыть/resize, WTstrip горизонтально скроллится при12ветках.
- [ ] Computedstyles: island13px/20, main/side tabs12px, forms14px, menu14px, secondary≥11px; случайные9/10px запрещены вне badge. Root16px не увеличивает Monaco дважды.
- [ ] CSS/textrole один: neutralchrome, максимум один semanticaccent, никакого blue tint у normal icons/text. Контраст normal text≥4.5:1 на фактическом фоне; importanticons/controls≥3:1. T3 subdued opacity не копировать слепо в мелкий текст.
- [ ] Keyboard: CtrlTab WT, F12/Lineage, F2 preview, CmdP, menu arrows/Escape/Enter/focusreturn, modal focustrap/close, surface tabs keyboard, pointer and keyboard resize. Скрытые edit/stopbuttons появляются и приfocus.
- [ ] Long paths, branch names,12processes, empty/recovered/error/loading states не ломают rowheight и не накрывают menu/tooltip/nativebrowser.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm test:electron`, packaged e2e. Новых backendтестов ради CSS не нужно; расширить UI smoke только для новых menu/keyboard/geometry веток.
- [ ] Сравнить на том же M1Pro16GB30warm switches со сборкой: p95 остаётся<20ms в этом smoke и нетrenderererrors; это guard этого UIпрохода, не обещание allrepos latency. Ввод Monaco и терминальныйoutput не вызывают fullWorkspace rerender. Нет новогоinterval/observer на каждом tree-row или layoutread на каждый input.
- [ ] Пересмотреть все8критериев. Любая оценка<8 требует исправления и нового snapshot конкретного сценария. Не повышать оценки заранее по одному CSSdiff.

Не проверено в этом read-only ревью: runtime T3 Appearance пользователя, remote GitHub и новая реализация после правок. Риск: слепой перенос rem utilities на текущий13px root или замена Canvasfont только CSS вновь создаст расхождение размеров; поэтому размеры и renderingmetrics проверяются вместе.
