'use client';

/**
 * An agent asking leave to do something (run a command, write a file): what it wants to do, the choices it offers,
 * and Don't allow. A long command scrolls inside the card; the card can be collapsed to read the conversation, and
 * its close button answers Don't allow.
 */
import React from 'react';
import { ShieldQuestion } from 'lucide-react';
import { useT } from '@/i18n';
import { CardActions, CardButton, ComposerCard } from '@/components/ComposerCard';

export function AgentPermissionCard({
  agentName,
  permission,
  onAnswer,
}: {
  agentName: string;
  permission: { title: string; options: Array<{ optionId: string; name: string; kind: string }> };
  /** null: Don't allow. */
  onAnswer: (optionId: string | null) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = React.useState(false);
  return (
    <ComposerCard
      role="alertdialog"
      icon={<ShieldQuestion size={14} />}
      title={t('composer.agentPermissionTitle').replace('{name}', agentName)}
      body={permission.title ? (
        <span className="whitespace-pre-wrap break-words font-mono text-[11.5px]">{permission.title}</span>
      ) : undefined}
      onClose={() => onAnswer(null)}
      collapse={{ collapsed, onToggle: () => setCollapsed((v) => !v), label: t(collapsed ? 'turnAsk.expand' : 'turnAsk.collapse') }}
    >
      <CardActions className="flex-wrap">
        <CardButton weight="quiet" onClick={() => onAnswer(null)}>
          {t('composer.agentPermissionDeny')}
        </CardButton>
        {permission.options.map((option, index) => (
          <CardButton
            key={option.optionId}
            weight={index === 0 && option.kind.startsWith('allow') ? 'primary' : 'secondary'}
            onClick={() => onAnswer(option.optionId)}
          >
            {option.name}
          </CardButton>
        ))}
      </CardActions>
    </ComposerCard>
  );
}
