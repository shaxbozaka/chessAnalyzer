import React from 'react';
import { jsPDF } from 'jspdf';

const GameSummary = ({ analysis, pgn, username }) => {
  if (!analysis || analysis.length === 0) return null;

  // Calculate stats
  const stats = analysis.reduce((acc, item) => {
    acc.total++;
    acc[item.label]++;
    return acc;
  }, { total: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });

  // Calculate accuracy percentage
  const weightedScore = (
    stats.excellent * 100 + 
    stats.good * 80 + 
    stats.inaccuracy * 50 + 
    stats.mistake * 20 + 
    stats.blunder * 0
  );
  const maxPossibleScore = stats.total * 100;
  const accuracy = Math.round((weightedScore / maxPossibleScore) * 100);

  // Get top 3 coaching tips
  const criticalMistakes = analysis
    .filter(item => item.label === 'blunder' || item.label === 'mistake')
    .slice(0, 3);

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Title
    doc.setFontSize(20);
    doc.text('Chess Game Analysis Report', pageWidth / 2, 20, { align: 'center' });
    
    // Player info
    doc.setFontSize(12);
    doc.text(`Player: ${username}`, 20, 35);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 42);
    
    // Game stats
    doc.setFontSize(16);
    doc.text('Game Statistics', 20, 55);
    doc.setFontSize(12);
    doc.text(`Accuracy: ${accuracy}%`, 25, 65);
    doc.text(`Excellent moves: ${stats.excellent}`, 25, 72);
    doc.text(`Good moves: ${stats.good}`, 25, 79);
    doc.text(`Inaccuracies: ${stats.inaccuracy}`, 25, 86);
    doc.text(`Mistakes: ${stats.mistake}`, 25, 93);
    doc.text(`Blunders: ${stats.blunder}`, 25, 100);
    
    // Critical mistakes
    doc.setFontSize(16);
    doc.text('Critical Moments', 20, 115);
    doc.setFontSize(12);
    
    let yPos = 125;
    if (criticalMistakes.length === 0) {
      doc.text('No critical mistakes found. Well played!', 25, yPos);
    } else {
      criticalMistakes.forEach((mistake, index) => {
        doc.text(`Move ${analysis.indexOf(mistake) + 1}: ${mistake.move.san}`, 25, yPos);
        yPos += 7;
        
        // Split long tips into multiple lines
        const tip = mistake.tip;
        const words = tip.split(' ');
        let line = '';
        
        for (let i = 0; i < words.length; i++) {
          const testLine = line + words[i] + ' ';
          if (doc.getTextWidth(testLine) > pageWidth - 50) {
            doc.text(line, 30, yPos);
            yPos += 7;
            line = words[i] + ' ';
          } else {
            line = testLine;
          }
        }
        
        if (line.trim() !== '') {
          doc.text(line, 30, yPos);
          yPos += 7;
        }
        
        doc.text(`Best move: ${mistake.bestMove}`, 30, yPos);
        yPos += 12;
      });
    }
    
    // Conclusion
    doc.setFontSize(16);
    doc.text('Conclusion', 20, yPos + 5);
    doc.setFontSize(12);
    
    let conclusion = '';
    if (accuracy >= 90) {
      conclusion = 'Excellent play! Your moves were very precise and followed strong strategic principles.';
    } else if (accuracy >= 80) {
      conclusion = 'Good game with solid play. A few improvements could be made in critical positions.';
    } else if (accuracy >= 60) {
      conclusion = 'Decent play with some tactical oversights. Focus on calculating variations more carefully.';
    } else {
      conclusion = 'Several missed opportunities in this game. Consider reviewing basic tactical patterns and strategic principles.';
    }
    
    const conclusionWords = conclusion.split(' ');
    let conclusionLine = '';
    yPos += 15;
    
    for (let i = 0; i < conclusionWords.length; i++) {
      const testLine = conclusionLine + conclusionWords[i] + ' ';
      if (doc.getTextWidth(testLine) > pageWidth - 40) {
        doc.text(conclusionLine, 25, yPos);
        yPos += 7;
        conclusionLine = conclusionWords[i] + ' ';
      } else {
        conclusionLine = testLine;
      }
    }
    
    if (conclusionLine.trim() !== '') {
      doc.text(conclusionLine, 25, yPos);
    }
    
    // Save the PDF
    doc.save(`chess_analysis_${username}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="mt-12 p-6 bg-white rounded-xl shadow-md">
      <h2 className="text-2xl font-bold mb-4">Game Summary</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">Statistics</h3>
          <div className="flex items-center mb-3">
            <div className="w-24 font-medium">Accuracy:</div>
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${accuracy >= 80 ? 'bg-green-500' : accuracy >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${accuracy}%` }}
                ></div>
              </div>
            </div>
            <div className="ml-2 font-semibold">{accuracy}%</div>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-full bg-green-500 mr-2"></div>
              <span>Excellent: {stats.excellent}</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-full bg-blue-500 mr-2"></div>
              <span>Good: {stats.good}</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-full bg-yellow-500 mr-2"></div>
              <span>Inaccuracies: {stats.inaccuracy}</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-full bg-orange-500 mr-2"></div>
              <span>Mistakes: {stats.mistake}</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-full bg-red-500 mr-2"></div>
              <span>Blunders: {stats.blunder}</span>
            </div>
          </div>
        </div>
        
        <div>
          <h3 className="text-lg font-semibold mb-2">Critical Moments</h3>
          {criticalMistakes.length === 0 ? (
            <p className="text-green-600">No critical mistakes found. Well played!</p>
          ) : (
            <ul className="space-y-2">
              {criticalMistakes.map((mistake, index) => (
                <li key={index} className="text-sm">
                  <span className="font-semibold">Move {analysis.indexOf(mistake) + 1}:</span> {mistake.tip}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      
      <div className="flex justify-center">
        <button
          onClick={generatePDF}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition"
        >
          Download Analysis Report
        </button>
      </div>
    </div>
  );
};

export default GameSummary;
