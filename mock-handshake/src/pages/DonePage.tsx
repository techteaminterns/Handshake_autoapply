import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApplyContext } from '../context/ApplyContext';

export default function DonePage() {
  const navigate = useNavigate();
  const { jobTitle, resumeFile, coverLetterFile } = useApplyContext();

  const resumeName =
    resumeFile instanceof File ? resumeFile.name : (resumeFile || 'Uploaded Resume');
  const coverLetterName =
    coverLetterFile instanceof File ? coverLetterFile.name : (coverLetterFile || 'None attached');

  const isMockPrefix = typeof window !== 'undefined' && window.location.pathname.startsWith('/mock-handshake');
  const basePrefix = isMockPrefix ? '/mock-handshake' : '';

  return (
    <div className="job-page-wrapper" data-testid="apply-complete">
      <div className="job-sheet-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: '#ecfdf5',
            color: '#059669',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            margin: '0 auto 20px',
          }}
        >
          ✓
        </div>
        <h1
          style={{ fontSize: '28px', fontWeight: 800, color: '#111827', margin: '0 0 8px 0' }}
          data-testid="apply-complete-heading"
        >
          Application submitted!
        </h1>
        <p style={{ fontSize: '15px', color: '#4b5563', margin: '0 0 24px 0' }}>
          Your application for <strong>{jobTitle || 'Assistant Manager'}</strong> has been successfully sent.
        </p>

        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px 20px',
            maxWidth: '400px',
            margin: '0 auto 28px',
            textAlign: 'left',
            fontSize: '14px',
          }}
        >
          <div style={{ marginBottom: '8px' }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Resume: </span>
            <span style={{ color: '#0f172a', fontWeight: 500 }}>{resumeName}</span>
          </div>
          <div>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Cover Letter: </span>
            <span style={{ color: '#0f172a', fontWeight: 500 }}>{coverLetterName}</span>
          </div>
        </div>

        <button
          type="button"
          className="btn-apply-solid"
          style={{ padding: '10px 24px' }}
          onClick={() => navigate(`${basePrefix}/job/1`)}
        >
          Back to Job Listing
        </button>
      </div>
    </div>
  );
}
