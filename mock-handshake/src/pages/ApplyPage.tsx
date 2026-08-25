import React, { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApplyContext } from '../context/ApplyContext';

export default function ApplyPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const {
    jobTitle,
    resumeFile,
    coverLetterFile,
    setResumeFile,
    setCoverLetterFile,
  } = useApplyContext();

  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const coverLetterInputRef = useRef<HTMLInputElement | null>(null);

  const displayJobTitle = jobTitle || 'Sprinkle Dreams';

  const handleResumeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setResumeFile(file);
    }
  };

  const handleCoverLetterFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverLetterFile(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resumeFile) return;

    console.log('Application submitted successfully:', {
      jobId: jobId || '1',
      jobTitle: displayJobTitle,
      resumeFile: resumeFile instanceof File ? resumeFile.name : resumeFile,
      coverLetterFile: coverLetterFile instanceof File ? coverLetterFile.name : coverLetterFile,
    });

    navigate('/done');
  };

  const isSubmitDisabled = !resumeFile;

  const resumeDisplayName = resumeFile instanceof File ? resumeFile.name : resumeFile;
  const coverLetterDisplayName = coverLetterFile instanceof File ? coverLetterFile.name : coverLetterFile;

  return (
    <div className="apply-page-wrapper">
      <div className="apply-modal-card">
        <div className="apply-modal-body">
          {/* Header Row with Title & Close (X) button */}
          <div className="apply-modal-header">
            <h1 className="apply-modal-title">Apply to {displayJobTitle}</h1>
            <button
              type="button"
              className="btn-modal-close"
              aria-label="Close"
              onClick={() => navigate(`/job/${jobId || 1}`)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Details from Employer notice */}
          <div className="apply-details-notice">
            <h2 className="notice-title">Details from {displayJobTitle}:</h2>
            <p className="notice-text">
              Applying for Assistant Manager requires a few documents. Attach them below and get one step closer to your next job!
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Section 1: Attach your resume */}
            <section className="doc-section">
              <h3 className="doc-section-title">1. Attach your resume</h3>

              <div className="doc-input-row">
                <div className="select-container">
                  <select
                    className="doc-dropdown-select"
                    defaultValue=""
                    aria-label="Search your CVs"
                  >
                    <option value="" disabled>
                      Search your CVs
                    </option>
                    <option value="2022_resume">2022 Resume</option>
                    <option value="new_resume_fall_21">new_resume_fall_21.pdf</option>
                  </select>
                </div>

                <span className="doc-or-divider">or</span>

                <button
                  type="button"
                  className="btn-upload-blue"
                  data-testid="resume-upload-btn"
                  onClick={() => resumeInputRef.current?.click()}
                >
                  Upload New
                </button>

                <input
                  type="file"
                  ref={resumeInputRef}
                  style={{ display: 'none' }}
                  data-testid="resume-file-input"
                  accept=".pdf,.doc,.docx"
                  onChange={handleResumeFileChange}
                />
              </div>

              {resumeDisplayName && (
                <div className="attached-file-badge">
                  📎 Attached: <strong>{resumeDisplayName}</strong>
                </div>
              )}

              <div className="recently-added-group">
                <span className="recently-added-label">Recently Added</span>
                <div className="chips-row">
                  <button
                    type="button"
                    className="doc-pill-chip"
                    onClick={() => setResumeFile('2022 Resume')}
                  >
                    2022 Resume
                  </button>
                  <button
                    type="button"
                    className="doc-pill-chip"
                    onClick={() => setResumeFile('new_resume_fall_21.pdf')}
                  >
                    new_resume_fall_21.pdf
                  </button>
                </div>
              </div>
            </section>

            {/* Section 2: Attach your cover letter */}
            <section className="doc-section" style={{ marginTop: '28px' }}>
              <h3 className="doc-section-title">2. Attach your cover letter</h3>

              <div className="doc-input-row">
                <div className="select-container">
                  <select
                    className="doc-dropdown-select"
                    defaultValue=""
                    aria-label="Search your cover letters"
                  >
                    <option value="" disabled>
                      Search your cover letters
                    </option>
                    <option value="cover_letter_2019">cover_letter_2019.pdf</option>
                  </select>
                </div>

                <span className="doc-or-divider">or</span>

                <button
                  type="button"
                  className="btn-upload-blue"
                  data-testid="cover-letter-upload-btn"
                  onClick={() => coverLetterInputRef.current?.click()}
                >
                  Upload New
                </button>

                <input
                  type="file"
                  ref={coverLetterInputRef}
                  style={{ display: 'none' }}
                  data-testid="cover-letter-file-input"
                  accept=".pdf,.doc,.docx"
                  onChange={handleCoverLetterFileChange}
                />
              </div>

              {coverLetterDisplayName && (
                <div className="attached-file-badge">
                  📎 Attached: <strong>{coverLetterDisplayName}</strong>
                </div>
              )}

              <div className="recently-added-group">
                <span className="recently-added-label">Recently Added</span>
                <div className="chips-row">
                  <button
                    type="button"
                    className="doc-pill-chip"
                    onClick={() => setCoverLetterFile('cover_letter_2019.pdf')}
                  >
                    cover_letter_2019.pdf
                  </button>
                </div>
              </div>
            </section>
          </form>
        </div>

        {/* Modal Footer with Submit Application button */}
        <div className="apply-modal-footer">
          <button
            type="button"
            className={`btn-submit-green ${isSubmitDisabled ? 'disabled' : ''}`}
            data-testid="submit-application-btn"
            disabled={isSubmitDisabled}
            onClick={handleSubmit}
          >
            Submit Application
          </button>
        </div>
      </div>
    </div>
  );
}
