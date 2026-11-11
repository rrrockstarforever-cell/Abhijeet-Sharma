import React from 'react';

interface ExamPatternDisplayProps {
  pattern: string;
}

export const ExamPatternDisplay: React.FC<ExamPatternDisplayProps> = ({ pattern }) => {
  return (
    <div className="exam-pattern-display">
      <h3>Exam Pattern</h3>
      <p>{pattern}</p>
    </div>
  );
};

// Default export for compatibility
export default ExamPatternDisplay;
