import React from 'react';
import { PrivacyPolicy, DataProcessingAgreement, ClientDataTerms, PublicOffer } from './LegalDocs';

/**
 * Правовые документы по постоянным адресам: /privacy, /offer и другим.
 *
 * Внутри приложения они открываются окном, но на такое окно нельзя дать ссылку.
 * А ссылка нужна: её спрашивают магазины приложений и площадки помощников, её же
 * удобно отправить клиенту или проверяющему. Здесь те же самые документы —
 * второй текст завести нельзя, разойдутся.
 */

export type PublicLegalDoc = 'PRIVACY' | 'OFFER' | 'AGREEMENT' | 'CLIENT_DATA';

/** Адрес → документ. По этому же списку строится маршрутизация в App.tsx. */
export const PUBLIC_LEGAL_ROUTES: Record<string, PublicLegalDoc> = {
  '/privacy': 'PRIVACY',
  '/offer': 'OFFER',
  '/agreement': 'AGREEMENT',
  '/client-data': 'CLIENT_DATA',
};

const LegalPublic: React.FC<{ doc: PublicLegalDoc }> = ({ doc }) => {
  const onBack = () => { window.location.href = '/'; };
  switch (doc) {
    case 'OFFER': return <PublicOffer onBack={onBack} />;
    case 'AGREEMENT': return <DataProcessingAgreement onBack={onBack} />;
    case 'CLIENT_DATA': return <ClientDataTerms onBack={onBack} />;
    default: return <PrivacyPolicy onBack={onBack} />;
  }
};

export default LegalPublic;
