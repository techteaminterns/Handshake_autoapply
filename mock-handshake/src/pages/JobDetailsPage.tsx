import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApplyContext } from '../context/ApplyContext';

export interface JobData {
  id: string;
  title: string;
  company: string;
  industry: string;
  postedDate: string;
  deadlineDate: string;
  salary: string;
  location: string;
  locationSubtext: string;
  jobType: string;
  workAuth: string;
  description: string;
}

export const FIXTURE_JOB: JobData = {
  id: '1',
  title: 'Assistant Manager',
  company: 'Sprinkle Dreams',
  industry: 'Restaurants & Food Service',
  postedDate: 'Posted 9 minutes ago',
  deadlineDate: 'Apply by September 19, 2024 at 6 AM',
  salary: '$50–65K/yr',
  location: 'Onsite, based in San Francisco, CA',
  locationSubtext: 'Work in person from the location',
  jobType: 'Full-time',
  workAuth: 'US work authorization required',
  description:
    "We're looking for an assistant manager to join our team at Sprinkle Dreams. As an assistant manager, you will play a crucial role in overseeing the day-to-day operations of the bakery and ensuring that our customers receive the best service and products. You will work closely with the store manager to develop and implement strategies to increase sales and meet financial targets. Additionally, you will be responsible for supervising and training staff, as well as maintaining inventory and ordering supplies. The ideal candidate will have a desire to learn!",
};

export default function JobDetailsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { setApplyData } = useApplyContext();

  const [saved, setSaved] = useState(false);

  const currentJob: JobData = {
    ...FIXTURE_JOB,
    id: jobId || FIXTURE_JOB.id,
  };

  const handleApply = () => {
    setApplyData({
      jobId: currentJob.id,
      jobTitle: currentJob.title,
    });
    const isMockPrefix = window.location.pathname.startsWith('/mock-handshake');
    navigate(isMockPrefix ? `/mock-handshake/apply/${currentJob.id}` : `/apply/${currentJob.id}`);
  };

  const handleSave = () => {
    setSaved((prev) => !prev);
  };

  return (
    <div className="job-page-wrapper">
      <div className="job-sheet-card">
        {/* Top Company Row */}
        <div className="company-header-row">
          <div className="company-logo-frame" aria-label="Sprinkle Dreams logo" />
          <div className="company-meta-group">
            <h2 className="company-title" data-testid="job-company">
              {currentJob.company}
            </h2>
            <div className="company-industry">{currentJob.industry}</div>
          </div>
        </div>

        {/* Job Title & Meta Line */}
        <h1 className="job-main-title" data-testid="job-title">
          {currentJob.title}
        </h1>
        <div className="job-timestamp-line">
          {currentJob.postedDate} • {currentJob.deadlineDate}
        </div>

        {/* Action Buttons: Save + Apply */}
        <div className="job-actions-row">
          <button
            type="button"
            className={`btn-save-outline ${saved ? 'active' : ''}`}
            data-testid="job-save-btn"
            onClick={handleSave}
          >
            <svg
              className="btn-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill={saved ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>

          <button
            type="button"
            className="btn-apply-solid"
            data-testid="job-apply-btn"
            onClick={handleApply}
          >
            Apply
          </button>
        </div>

        <div className="job-section-divider" />

        {/* At a glance Section */}
        <section className="at-a-glance-block">
          <h3 className="glance-heading">At a glance</h3>

          <div className="glance-items-list">
            {/* Salary */}
            <div className="glance-item">
              <div className="glance-icon-col">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#111827"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="12" x="2" y="6" rx="2" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M6 12h.01M18 12h.01" />
                </svg>
              </div>
              <div className="glance-text-col">
                <div className="glance-primary-text" data-testid="job-salary">
                  {currentJob.salary}
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="glance-item">
              <div className="glance-icon-col">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#111827"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div className="glance-text-col">
                <div className="glance-primary-text" data-testid="job-location">
                  {currentJob.location}
                </div>
                <div className="glance-secondary-text">{currentJob.locationSubtext}</div>
              </div>
            </div>

            {/* Job Type */}
            <div className="glance-item">
              <div className="glance-icon-col">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#111827"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
                  <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
                </svg>
              </div>
              <div className="glance-text-col">
                <div className="glance-primary-text">Job</div>
                <div className="glance-secondary-text" data-testid="job-type">
                  {currentJob.jobType}
                </div>
              </div>
            </div>

            {/* Work Auth */}
            <div className="glance-item">
              <div className="glance-icon-col">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#111827"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" />
                </svg>
              </div>
              <div className="glance-text-col">
                <div className="glance-primary-text" data-testid="job-work-auth">
                  {currentJob.workAuth}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="job-section-divider" />

        {/* Description Section */}
        <section className="job-body-section">
          <p className="job-body-paragraph" data-testid="job-description">
            {currentJob.description}
          </p>
        </section>
      </div>
    </div>
  );
}
