export type ReusableImageLicense = { label: 'CC0' | 'Public domain'; url: string };

export interface LicensedImageFields {
  image?: string;
  imageCaption?: string;
  imageSourceUrl?: string;
  imageLicence?: string;
  imageLicenceUrl?: string;
  imageId?: string;
  imageVerified?: boolean;
}

export function normalizeReusableImageLicense(label: unknown, url: unknown = ''): ReusableImageLicense | null {
  const name = String(label ?? '').trim();
  const link = String(url ?? '').trim();
  if (/creativecommons\.org\/licenses\/by(?:-sa|-nc|-nd)?\//i.test(link)) return null;
  const labelIsCC0 = /^cc0(?:\b|\s)/i.test(name);
  const labelIsPublicDomain = /\bpublic domain\b|^pd(?:[-\s]|$)/i.test(name);
  if (name && !labelIsCC0 && !labelIsPublicDomain) return null;
  if (labelIsCC0 || (!name && /creativecommons\.org\/publicdomain\/zero(?:\/|$)/i.test(link))) {
    return { label: 'CC0', url: link };
  }
  if (labelIsPublicDomain || (!name && /creativecommons\.org\/publicdomain\/mark(?:\/|$)/i.test(link))) {
    return { label: 'Public domain', url: link };
  }
  return null;
}

export function stripUnlicensedImageFields<T extends LicensedImageFields>(record: T): T {
  if (!record.image || normalizeReusableImageLicense(record.imageLicence, record.imageLicenceUrl)) return record;
  return {
    ...record,
    image: undefined,
    imageCaption: undefined,
    imageSourceUrl: undefined,
    imageLicence: undefined,
    imageLicenceUrl: undefined,
    imageId: undefined,
    imageVerified: undefined,
  };
}
