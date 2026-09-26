"""
Tests for T1: Create book endpoint (POST /books)
"""
import json
import sys
import os
import subprocess
import time
import urllib.request
import urllib.error
from unittest import TestCase

# Add workspace to path
sys.path.insert(0, '/workspace')


def make_request(method, path, json_data=None):
    """Make HTTP request to the book server."""
    url = f"http://127.0.0.1:8000{path}"
    if method == 'GET':
        req = urllib.request.Request(url, headers={'User-Agent': 'test'})
    elif method == 'POST':
        if json_data is None:
            data = b"not json"
        else:
            data = json.dumps(json_data).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={
            'Content-Type': 'application/json',
            'User-Agent': 'test'
        })
    else:
        raise ValueError(f"Unknown method {method}")
    
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.loads(resp.read().decode())
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        raise RuntimeError(f"Request failed: {e}")


class T1Tests(TestCase):
    """Test cases for T1 scenarios."""
    
    def setUp(self):
        """Start the book server."""
        self.proc = subprocess.Popen([
            sys.executable, '/workspace/app.py'
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(2)  # Allow server to start
    
    def tearDown(self):
        """Stop the server."""
        self.proc.terminate()
        self.proc.wait(timeout=5)
    
    def test_T1_S1_happy_create(self):
        """S1 [happy] Create book - T1.S1"""
        status, body = make_request('POST', '/books', {
            "title": "The Great Book",
            "author": "John Doe",
            "isbn": "123456789"
        })
        self.assertEqual(status, 201)
        self.assertIn('id', body)
        self.assertEqual(body['id'], 1)
        self.assertEqual(body['title'], "The Great Book")
        self.assertEqual(body['author'], "John Doe")
        self.assertEqual(body['isbn'], "123456789")
    
    def test_T1_S2_unhappy_invalid_json(self):
        """S2 [unhappy] Invalid JSON body - T1.S2"""
        status, body = make_request('POST', '/books', json_data="not json")
        self.assertEqual(status, 400)
        self.assertIn('error', body)
        self.assertEqual(body['error'], "invalid JSON")
    
    def test_T1_S3_unhappy_missing_title_empty(self):
        """S3 [unhappy] Missing required title field (empty) - T1.S3"""
        status, body = make_request('POST', '/books', {
            "title": "",
            "author": "John Doe",
            "isbn": "123456"
        })
        self.assertEqual(status, 400)
        self.assertIn('error', body)
        self.assertEqual(body['error'], "title is empty")
    
    def test_T1_S4_happy_create_happy(self):
        """T1.S4 [happy] Create_happy"""
        status, body = make_request('POST', '/books', {
            "title": "Book Two",
            "author": "Jane Smith",
            "isbn": "987654321"
        })
        self.assertEqual(status, 201)
        self.assertEqual(body['id'], 2)
