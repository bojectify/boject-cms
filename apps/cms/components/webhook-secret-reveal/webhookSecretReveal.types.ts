import type { BasicComponentProps } from '~/types/basicComponentProps';

export type WebhookSecretRevealProps = BasicComponentProps & {
  secret: string;
};
